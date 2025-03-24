import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  copilotDormancy,
  GithubIssueNotifier,
  OctokitClient,
  LastActivityRecord,
  createDefaultNotificationBodyHandler,
} from '@dormant-accounts/github';
import { createBranch } from './utils/createBranch';
import { getActivityLog } from './utils/getActivityLog';
import { writeFile } from 'fs/promises';
import { checkBranch } from './utils/checkBranch';
import {
  getNotificationContext,
  NotificationContext,
} from './utils/getNotificationContext';
import { updateActivityLog } from './utils/updateActivityLog';

// Function to safely stringify data for output
const safeStringify = (data: unknown): string => {
  try {
    return JSON.stringify(data);
  } catch (error) {
    return JSON.stringify({
      error: 'Failed to stringify data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Helper function to format date for human readability
const formatDate = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return isoString;
  }
};

export async function processNotifications(
  octokit: OctokitClient,
  context: NotificationContext,
  dormantAccounts: LastActivityRecord[],
  removeAccount?: ({
    lastActivityRecord,
  }: {
    lastActivityRecord: LastActivityRecord;
  }) => Promise<boolean>,
) {
  const notifier = new GithubIssueNotifier({
    githubClient: octokit,
    gracePeriod: context.duration,
    repository: {
      ...context.repo,
      baseLabels: context.baseLabels,
    },
    notificationBody: createDefaultNotificationBodyHandler(context.body),
    dryRun: context.dryRun,
    // Add the removeAccountHandler to handle account removal,
    removeAccount,
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
    const dryRun = core.getInput('dry-run') === 'true';
    const checkType = 'copilot-dormancy';

    const notificationsContext = getNotificationContext();
    const sendNotifications = notificationsContext !== false;

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

    // Initialize GitHub client
    const octokit = github.getOctokit(token);

    const activityLog = await getActivityLog(
      octokit,
      activityLogContext.repo,
      branchName,
      activityLogContext.path,
    );

    if (activityLog) {
      core.info('Activity log exists, fetching latest activity...');
      await writeFile(activityLogContext.path, activityLog.content);
      core.info(`Activity log fetched and saved to ${activityLogContext.path}`);
    } else {
      core.info('Activity log does not exist, creating new one...');
    }

    const existingActivityLogSha = activityLog ? activityLog.sha : undefined;

    // Run dormancy check
    const check = await copilotDormancy({
      type: checkType,
      duration,
      dryRun,
      conf: {
        octokit,
        org,
      },
    });

    // Fetch latest activity if needed
    await check.fetchActivity();

    if (core.isDebug()) {
      core.debug(
        `Fetched activity: ${safeStringify(await check.getDatabaseData())}`,
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

    // Save activity log if repo info is provided
    if (activityLogRepo) {
      core.info(`Saving activity log to ${activityLogRepo}`);

      try {
        const dateStamp = new Date().toISOString().split('T')[0];
        const content = await check.getDatabaseData();

        const contentBase64 = Buffer.from(
          JSON.stringify(content, null, 2),
        ).toString('base64');

        if (!dryRun) {
          // Check if the branch exists
          const branchExists = await checkBranch(
            octokit,
            activityLogContext.repo,
            branchName,
          );

          if (!branchExists) {
            core.info(`Creating branch: ${branchName}`);
            await createBranch(octokit, activityLogContext.repo, checkType);
          } else {
            core.debug(`Branch already exists: ${branchName}`);
          }

          await updateActivityLog(octokit, activityLogContext.repo, {
            branch: branchName,
            path: activityLogContext.path,
            sha: existingActivityLogSha,
            message: `Update Copilot dormancy log for ${dateStamp}`,
            content: contentBase64,
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

    // Create a human-friendly job summary
    core.summary
      .addHeading('Copilot Dormancy Check Summary')
      .addRaw(
        `**Last Activity Fetch:** ${formatDate(summary.lastActivityFetch)}`,
        true,
      )
      .addRaw(`**Dormancy Threshold:** ${summary.duration}`, true)
      .addBreak()
      .addHeading('Account Status Summary', 3)
      .addTable([
        [
          { data: 'Count', header: true },
          { data: 'Percentage', header: true },
          { data: 'Account Type', header: true },
        ],
        [
          'Active Accounts',
          summary.activeAccounts.toString(),
          `${summary.activeAccountPercentage.toFixed(1)}%`,
        ],
        [
          'Dormant Accounts',
          summary.dormantAccounts.toString(),
          `${summary.dormantAccountPercentage.toFixed(1)}%`,
        ],
        ['Total Accounts', summary.totalAccounts.toString(), '100%'],
      ]);

    // If there are dormant accounts, add a section about them
    if (dormantAccounts.length > 0) {
      core.summary
        .addHeading('Dormant Accounts', 3)
        .addRaw(
          `${dormantAccounts.length} accounts have been inactive for at least ${summary.duration}.`,
          true,
        );

      core.summary.addEOL();

      if (sendNotifications) {
        core.summary.addRaw(
          'Notifications are being sent to these accounts.',
          true,
        );
      } else {
        core.summary.addRaw(
          'No notifications are being sent (notifications disabled).',
          true,
        );
      }
    }

    if (sendNotifications) {
      core.debug(
        'Notification context: ' + safeStringify(notificationsContext),
      );

      const notifications = await processNotifications(
        octokit,
        notificationsContext,
        dormantAccounts,
        //check.removeUser.bind(check),
      );

      core.setOutput('notification-results', safeStringify(notifications));

      core.info(
        `Created notifications for ${notifications.notified.length} dormant accounts`,
      );
      core.info(
        `Closed notifications for ${notifications.reactivated.length} no longer dormant accounts`,
      );
      core.info(`Removed ${notifications.removed.length} dormant accounts`);

      // Add notification results to summary
      core.summary.addHeading('Notification Results', 3).addTable([
        [
          { data: 'Action', header: true },
          { data: 'Count', header: true },
        ],
        ['New notifications created', notifications.notified.length.toString()],
        [
          'Notifications closed (reactivated users)',
          notifications.reactivated.length.toString(),
        ],
        [
          'Users removed after grace period',
          notifications.removed.length.toString(),
        ],
        [
          'Users with admin exclusions',
          notifications.excluded.length.toString(),
        ],
        [
          'Users in grace period',
          notifications.inGracePeriod.length.toString(),
        ],
        ['Errors encountered', notifications.errors.length.toString()],
      ]);

      // Function to generate a link list for notification issues
      const generateIssueLinkList = (
        notificationItems: Array<{ user: string; notification: any }>,
        title: string,
      ) => {
        if (notificationItems.length === 0) return;

        core.summary.addHeading(title, 4);

        core.summary.addList(
          notificationItems.map(
            ({ notification }) =>
              `<a href="${notification.html_url}">${notification.title}</a>`,
          ),
        );

        core.summary.addEOL();
      };

      // Add issue links for each notification category
      if (notifications.notified.length > 0) {
        generateIssueLinkList(
          notifications.notified,
          'Newly Created Notifications',
        );
      }

      if (notifications.reactivated.length > 0) {
        generateIssueLinkList(
          notifications.reactivated,
          'Closed Notifications (Users Became Active)',
        );
      }

      if (notifications.removed.length > 0) {
        generateIssueLinkList(
          notifications.removed,
          'Users Removed (Grace Period Expired)',
        );
      }

      if (notifications.excluded.length > 0) {
        generateIssueLinkList(notifications.excluded, 'Admin Exclusions');
      }

      if (notifications.inGracePeriod.length > 0) {
        generateIssueLinkList(
          notifications.inGracePeriod,
          'Users in Grace Period',
        );
      }

      // If there were any errors, show details
      if (notifications.errors.length > 0) {
        core.summary
          .addHeading('Notification Errors', 4)
          .addRaw(
            'The following errors occurred during notification processing:',
          )
          .addEOL();

        notifications.errors.forEach(({ user, error }, index) => {
          core.summary.addRaw(
            `${index + 1}. **${user}**: ${error.message}`,
            true,
          );
        });
      }
    } else {
      core.info('Notifications are disabled');
    }

    await core.summary.write();

    core.info('Copilot dormancy check completed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed with error: ${errorMessage}`);
    core.setOutput('error', errorMessage);
    throw error; // Rethrow the error to ensure the action fails
  }
}

// For testing purposes, export the run function
export { run };
