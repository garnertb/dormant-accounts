import * as core from '@actions/core';
import {
  GithubIssueNotifier,
  OctokitClient,
  LastActivityRecord,
  ProcessingResult,
} from '@dormant-accounts/github';
import { copilotDormancy } from '@dormant-accounts/github/copilot';
import {
  addCheckSummary,
  addNotificationResultsSummary,
  createThrottledOctokit,
  getNotificationContext,
  loadActivityLog,
  logNotificationResults,
  NotificationContext,
  safeStringify,
  saveActivityLog,
} from '@dormant-accounts/action-utils';
import { removeCopilotLicense } from './utils/removeCopilotLicense';
import { Activity } from 'dormant-accounts';

/**
 * Notification settings for the Copilot check
 */
export interface CopilotNotificationContext extends NotificationContext {
  /** Whether users may be removed from the team that assigns their Copilot seat */
  allowTeamRemoval: boolean;
}

export async function processNotifications(
  octokit: OctokitClient,
  notificationsOctokit: OctokitClient,
  context: CopilotNotificationContext,
  dormantAccounts: LastActivityRecord[],
  check: {
    activity: Activity;
  },
  dormantAfter: string,
  org: string,
) {
  const {
    duration: gracePeriod,
    body,
    assignUserToIssue,
    removeDormantAccounts,
    allowTeamRemoval,
    repo,
    baseLabels,
    dryRun,
  } = context;

  const notifier = new GithubIssueNotifier({
    githubClient: notificationsOctokit,
    gracePeriod,
    repository: {
      ...repo,
      baseLabels,
    },
    notificationBody: body,
    assignUserToIssue,
    dryRun,
    dormantAfter,
    removeAccount: async ({ lastActivityRecord }) => {
      return removeCopilotLicense({
        lastActivityRecord,
        octokit,
        owner: org,
        removeDormantAccounts,
        allowTeamRemoval,
        activity: check.activity,
      });
    },
  });

  return notifier.processDormantUsers(dormantAccounts);
}

async function run(): Promise<void> {
  try {
    // Get inputs from workflow
    const org = core.getInput('org');
    const activityLogRepo = core.getInput('activity-log-repo');
    const duration = core.getInput('duration');
    const token = core.getInput('token');
    const activityLogToken = core.getInput('activity-log-token') || token;
    const notificationsToken = core.getInput('notifications-token') || token;
    const dryRun = core.getInput('dry-run') === 'true';
    const authenticatedAtBehavior = core.getInput(
      'authenticated-at-behavior',
    ) as 'ignore' | 'fallback' | 'most-recent';
    const checkType = 'copilot-dormancy';

    const baseNotificationsContext = getNotificationContext({
      baseLabel: checkType,
      dryRun,
    });
    const notificationsContext: CopilotNotificationContext | false =
      baseNotificationsContext && {
        ...baseNotificationsContext,
        allowTeamRemoval: core.getBooleanInput(
          'remove-user-from-assigning-team',
        ),
      };
    const sendNotifications = notificationsContext !== false;
    let notificationsResults: ProcessingResult | null = null;

    const branchName = checkType;

    const [owner, repo] = activityLogRepo.split('/');

    if (!dryRun && (!owner || !repo)) {
      throw new Error(
        `Invalid activity log repo format. Expected "owner/repo", got "${activityLogRepo}"`,
      );
    }

    const activityLogContext = {
      path: `${checkType}.json`,
      repo: {
        owner: owner as string,
        repo: repo as string,
      },
    };

    // Log configuration (without sensitive data)
    core.info(`Starting Copilot dormancy check for org: ${org}`);
    core.info(`Duration threshold: ${duration}`);
    core.info(`Dry run mode: ${dryRun}`);

    if (sendNotifications) {
      core.info(
        `Notifications enabled with grace period: ${notificationsContext.duration}`,
      );
      core.info(
        `Notification repository: ${notificationsContext.repo.owner}/${notificationsContext.repo.repo}`,
      );
    }

    // Initialize GitHub client with throttling
    const octokit = createThrottledOctokit({ token });
    const activityLogOctokit = createThrottledOctokit({
      token: activityLogToken,
    });
    const notificationsOctokit = createThrottledOctokit({
      token: notificationsToken,
    });

    const existingActivityLogSha = await loadActivityLog(activityLogOctokit, {
      repo: activityLogContext.repo,
      branch: branchName,
      path: activityLogContext.path,
    });

    // Run dormancy check
    const check = await copilotDormancy({
      type: checkType,
      duration,
      dryRun,
      conf: {
        octokit,
        org,
        authenticatedAtBehavior,
      },
    });

    // Fetch latest activity if needed
    await check.fetchActivity();

    if (core.isDebug()) {
      core.debug(
        `Fetched activity: ${safeStringify(await check.activity.all())}`,
      );
    }

    // Get dormant and active accounts
    const dormantAccounts = await check.listDormantAccounts();
    const activeAccounts = await check.listActiveAccounts();

    // Get the summary with statistics
    const summary = await check.summarize();

    // Set outputs
    core.info(
      `Found ${summary.dormantAccounts} dormant accounts and ${summary.activeAccounts} active accounts`,
    );
    core.setOutput('dormant-users', safeStringify(dormantAccounts));
    core.setOutput('active-users', safeStringify(activeAccounts));
    core.setOutput('last-activity-fetch', summary.lastActivityFetch);
    core.setOutput('check-stats', safeStringify(summary));

    // Log the summary statistics
    core.info(`Check summary: ${safeStringify(summary)}`);

    addCheckSummary({
      heading: 'Copilot Dormancy Check Summary',
      summary,
      notificationsEnabled: sendNotifications,
    });

    if (sendNotifications) {
      core.debug(
        'Notification context: ' + safeStringify(notificationsContext),
      );

      notificationsResults = await processNotifications(
        octokit,
        notificationsOctokit,
        notificationsContext,
        dormantAccounts,
        check,
        duration,
        org,
      );

      core.setOutput(
        'notification-results',
        safeStringify(notificationsResults),
      );

      logNotificationResults(notificationsResults, {
        dryRun: notificationsContext.dryRun,
      });
      addNotificationResultsSummary(notificationsResults, {
        dryRun: notificationsContext.dryRun,
      });
    } else {
      core.info('Notifications are disabled');
    }

    await core.summary.write();

    // Save activity log if repo info is provided
    if (activityLogRepo) {
      core.info(`Saving activity log to ${activityLogRepo}`);

      try {
        if (!dryRun) {
          const dateStamp = new Date().toISOString().split('T')[0];
          await saveActivityLog(activityLogOctokit, {
            repo: activityLogContext.repo,
            branch: branchName,
            path: activityLogContext.path,
            sha: existingActivityLogSha,
            message: `Update Copilot dormancy log for ${dateStamp}`,
            content: await check.activity.all(),
          });

          core.info(
            `Activity log saved to ${org}/${activityLogRepo}/${activityLogContext.path}`,
          );
        } else {
          core.info(
            `Dry run: Activity log would be saved to ${org}/${activityLogRepo}/${activityLogContext.path}`,
          );
        }
      } catch (error) {
        core.setFailed(
          `Failed to save activity log: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    core.info('Copilot dormancy check completed successfully');

    if (notificationsResults && notificationsResults.errors.length > 0) {
      core.setFailed(
        `Action failed due to errors sending notifications: ${notificationsResults.errors.map(({ error }) => error.message).join(', ')}`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed with error: ${errorMessage}`);
    core.setOutput('error', errorMessage);
    throw error; // Rethrow the error to ensure the action fails
  }
}

// For testing purposes, export the run function
export { run };
