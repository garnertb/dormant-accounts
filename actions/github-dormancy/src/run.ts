import * as core from '@actions/core';
import { rm } from 'fs/promises';
import {
  addCheckSummary,
  addNotificationResultsSummary,
  createThrottledOctokit,
  errorMessage,
  getNotificationContext,
  loadActivityLog,
  logNotificationResults,
  safeStringify,
  saveActivityLog,
  type NotificationContext,
} from '@dormant-accounts/action-utils';
import {
  createRemoveOrgMemberHandler,
  defaultWhitelistHandler,
  GithubIssueNotifier,
  githubMembershipDormancy,
  type LastActivityRecord,
  type OctokitClient,
  type ProcessingResult,
  type RemoveAccountHandler,
} from '@dormant-accounts/github';
import { readInputs, validateDuration, type ActionInputs } from './inputs';
import { buildDefaultNotificationBody } from './notificationBody';

/** Check type, activity log branch and notification base label */
export const CHECK_TYPE = 'github-dormancy';

/** Activity log file, in the repository and in the working directory */
export const ACTIVITY_LOG_PATH = `${CHECK_TYPE}.json`;

const skipRemoval: RemoveAccountHandler = async () => 'skipped';

interface ProcessNotificationsOptions {
  inputs: ActionInputs;
  context: NotificationContext;
  octokit: OctokitClient;
  notificationsOctokit: OctokitClient;
  dormantAccounts: LastActivityRecord[];
  inScopeLogins: string[];
}

/**
 * Notifies dormant accounts, closes notifications for accounts that are active
 * or out of scope, and removes accounts whose grace period has expired when
 * removal is enabled.
 *
 * @param options - Inputs, notification settings, clients and accounts
 * @returns The notifier's processing result
 */
export async function processNotifications({
  inputs,
  context,
  octokit,
  notificationsOctokit,
  dormantAccounts,
  inScopeLogins,
}: ProcessNotificationsOptions): Promise<ProcessingResult> {
  const { org, duration, includeCopilotActivity, notificationCommentsRepo } =
    inputs;

  const notifier = new GithubIssueNotifier({
    githubClient: notificationsOctokit,
    gracePeriod: context.duration,
    notificationBody:
      context.body.trim() ||
      buildDefaultNotificationBody({
        org,
        includeCopilotActivity,
        countNotificationComments: notificationCommentsRepo !== undefined,
        removeDormantAccounts: context.removeDormantAccounts,
      }),
    repository: { ...context.repo, baseLabels: context.baseLabels },
    assignUserToIssue: context.assignUserToIssue,
    dryRun: context.dryRun,
    dormantAfter: duration,
    removeAccount: context.removeDormantAccounts
      ? createRemoveOrgMemberHandler({
          octokit,
          notificationsOctokit,
          org,
          repository: context.repo,
        })
      : skipRemoval,
  });

  return notifier.processDormantUsers(dormantAccounts, { inScopeLogins });
}

/**
 * Runs the GitHub dormancy check: loads the activity log, fetches activity,
 * saves the log and then processes notifications. Nothing is saved, notified
 * or removed if fetching activity or saving the log fails.
 */
export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    const { org, duration, dryRun } = inputs;

    const notificationsRequested =
      core.getInput('notifications-enabled') === 'true';
    const notificationContext = getNotificationContext({
      baseLabel: CHECK_TYPE,
      dryRun,
    });

    if (notificationsRequested && !notificationContext) {
      throw new Error('Invalid notification inputs');
    }

    if (notificationContext) {
      validateDuration(notificationContext.duration, 'notifications-duration');
    } else if (core.getInput('remove-dormant-accounts') === 'true') {
      core.warning(
        'remove-dormant-accounts has no effect unless notifications-enabled is true',
      );
    }

    core.info(`Starting GitHub dormancy check for org: ${org}`);
    core.info(`Duration threshold: ${duration}`);
    core.info(`Dry run mode: ${dryRun}`);
    core.info(
      `Activity sources: ${[
        'audit log',
        ...(inputs.includeCopilotActivity ? ['Copilot'] : []),
        ...(inputs.notificationCommentsRepo ? ['notification comments'] : []),
      ].join(', ')}`,
    );

    if (notificationContext) {
      core.info(
        `Notifications enabled with grace period: ${notificationContext.duration}`,
      );
      core.info(
        `Notification repository: ${notificationContext.repo.owner}/${notificationContext.repo.repo}`,
      );
      core.info(
        `Account removal: ${notificationContext.removeDormantAccounts ? 'enabled' : 'disabled'}`,
      );
    }

    const octokit = createThrottledOctokit({ token: inputs.token });
    const activityLogOctokit = createThrottledOctokit({
      token: inputs.activityLogToken,
    });
    const notificationsOctokit = createThrottledOctokit({
      token: inputs.notificationsToken,
    });

    const activityLog = {
      repo: inputs.activityLogRepo,
      branch: CHECK_TYPE,
      path: ACTIVITY_LOG_PATH,
    };
    const activityLogName = `${activityLog.repo.owner}/${activityLog.repo.repo}@${activityLog.branch}:${activityLog.path}`;

    const activityLogSha = await loadActivityLog(
      activityLogOctokit,
      activityLog,
    );

    if (!activityLogSha) {
      // Never start from a stale local file when no log has been saved
      await rm(ACTIVITY_LOG_PATH, { force: true });
    }

    const { excludeUsers, notificationCommentsRepo } = inputs;

    const check = githubMembershipDormancy({
      type: CHECK_TYPE,
      duration,
      dryRun,
      firstSeenBaseline: inputs.firstSeenBaseline,
      isWhitelisted: async (args) =>
        excludeUsers.has(args.login.toLowerCase()) ||
        defaultWhitelistHandler(args),
      conf: {
        octokit,
        org,
        authenticatedAtBehavior: inputs.authenticatedAtBehavior,
        includeCopilotActivity: inputs.includeCopilotActivity,
        includeOutsideCollaborators: inputs.includeOutsideCollaborators,
        allowActivityGap: inputs.allowActivityGap,
        countNotificationComments: notificationCommentsRepo && {
          octokit: notificationsOctokit,
          ...notificationCommentsRepo,
          baseLabels: [CHECK_TYPE],
        },
      },
    });

    await check.fetchActivity();

    if (core.isDebug()) {
      core.debug(
        `Fetched activity: ${safeStringify(await check.activity.all())}`,
      );
    }

    const dormantAccounts = await check.listDormantAccounts();
    const activeAccounts = await check.listActiveAccounts();
    const summary = await check.summarize();

    core.info(
      `Found ${summary.dormantAccounts} dormant accounts and ${summary.activeAccounts} active accounts`,
    );
    core.setOutput('dormant-users', safeStringify(dormantAccounts));
    core.setOutput('active-users', safeStringify(activeAccounts));
    core.setOutput('last-activity-fetch', summary.lastActivityFetch);
    core.setOutput('check-stats', safeStringify(summary));
    core.info(`Check summary: ${safeStringify(summary)}`);

    addCheckSummary({
      heading: 'GitHub Dormancy Check Summary',
      summary,
      notificationsEnabled: notificationContext !== false,
    });

    // Save before notifying so a failed save never leaves notifications or
    // removals without a matching activity log
    if (dryRun) {
      core.info(`Dry run: activity log not saved to ${activityLogName}`);
    } else {
      const dateStamp = new Date().toISOString().split('T')[0];
      await saveActivityLog(activityLogOctokit, {
        ...activityLog,
        sha: activityLogSha,
        message: `Update GitHub dormancy log for ${dateStamp}`,
        content: await check.activity.all(),
      });
      core.info(`Activity log saved to ${activityLogName}`);
    }

    let notificationResults: ProcessingResult | undefined;

    if (notificationContext) {
      const inScopeLogins = (await check.listAccounts()).map(
        ({ login }) => login,
      );

      notificationResults = await processNotifications({
        inputs,
        context: notificationContext,
        octokit,
        notificationsOctokit,
        dormantAccounts,
        inScopeLogins,
      });

      core.setOutput(
        'notification-results',
        safeStringify({
          ...notificationResults,
          errors: notificationResults.errors.map(({ user, error }) => ({
            user,
            error: errorMessage(error),
          })),
        }),
      );
      logNotificationResults(notificationResults, {
        dryRun: notificationContext.dryRun,
      });
      addNotificationResultsSummary(notificationResults, {
        dryRun: notificationContext.dryRun,
      });
    } else {
      core.info('Notifications are disabled');
    }

    await core.summary.write();

    if (notificationResults && notificationResults.errors.length > 0) {
      core.setFailed(
        `Action failed due to errors processing notifications: ${notificationResults.errors
          .map(({ user, error }) => `${user}: ${errorMessage(error)}`)
          .join(', ')}`,
      );
      return;
    }

    core.info('GitHub dormancy check completed successfully');
  } catch (error) {
    const message = errorMessage(error);
    core.setFailed(`Action failed with error: ${message}`);
    core.setOutput('error', message);
    throw error;
  }
}
