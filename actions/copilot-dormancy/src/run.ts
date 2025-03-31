import * as core from '@actions/core';
import {
  GithubIssueNotifier,
  OctokitClient,
  LastActivityRecord,
  createDefaultNotificationBodyHandler,
  revokeCopilotLicense,
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
import { Activity } from 'dormant-accounts';
import { ProcessingResult } from '@dormant-accounts/github/';
import { getContext } from './utils/getContext';

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
  check: {
    activity: Activity;
  },
) {
  const {
    duration: gracePeriod,
    body,
    assignUserToIssue,
    removeDormantAccounts,
    repo,
    baseLabels,
    dryRun,
  } = context;

  const notifier = new GithubIssueNotifier({
    githubClient: octokit,
    gracePeriod,
    repository: {
      ...repo,
      baseLabels,
    },
    notificationBody: createDefaultNotificationBodyHandler(body),
    assignUserToIssue,
    dryRun,
    removeAccount: async ({ lastActivityRecord }) => {
      if (!removeDormantAccounts) {
        core.info(
          `removeDormantAccounts is false, skipping removal for: ${lastActivityRecord.login}`,
        );
        return true;
      }

      const accountRemoved = await revokeCopilotLicense({
        logins: lastActivityRecord.login,
        octokit,
        org: context.repo.owner,
        dryRun: removeDormantAccounts,
      });

      if (accountRemoved) {
        core.info(
          `Successfully removed Copilot license for ${lastActivityRecord.login}`,
        );
        await check.activity.remove(lastActivityRecord.login);
      }

      return accountRemoved;
    },
  });
  return notifier.processDormantUsers(dormantAccounts);
}

async function run(): Promise<void> {
  try {
    // Get inputs from workflow
    const context = getContext();
    const notificationsContext = getNotificationContext();
    const sendNotifications = notificationsContext !== false;
    let notificationsResults: ProcessingResult | null = null;

    if (!context) {
      core.setFailed('Invalid context. Please check the action inputs.');
      throw new Error('Invalid context');
    }

    const {
      check,
      octokit,
      activityLog: activityLogContext,
      org,
      duration,
      dryRun,
    } = context;

    // Log configuration (without sensitive data)
    core.info(`Starting ${check.type} dormancy check for org: ${org}`);
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

    const activityLog = await getActivityLog(context);

    if (activityLog) {
      core.info('Activity log exists, fetching latest activity...');
      await writeFile(activityLogContext.path, activityLog.content);
      core.info(`Activity log fetched and saved to ${activityLogContext.path}`);
    } else {
      core.info('Activity log does not exist, creating new one...');
    }

    const existingActivityLogSha = activityLog ? activityLog.sha : undefined;

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

      notificationsResults = await processNotifications(
        octokit,
        notificationsContext,
        dormantAccounts,
        check,
      );

      core.setOutput(
        'notification-results',
        safeStringify(notificationsResults),
      );

      core.info(
        `Created notifications for ${notificationsResults.notified.length} dormant accounts`,
      );
      core.info(
        `Closed notifications for ${notificationsResults.reactivated.length} no longer dormant accounts`,
      );
      core.info(
        `Removed ${notificationsResults.removed.length} dormant accounts`,
      );

      // Add notification results to summary
      core.summary.addHeading('Notification Results', 3).addTable([
        [
          { data: 'Action', header: true },
          { data: 'Count', header: true },
        ],
        [
          'New notifications created',
          notificationsResults.notified.length.toString(),
        ],
        [
          'Notifications closed (reactivated users)',
          notificationsResults.reactivated.length.toString(),
        ],
        [
          'Users removed after grace period',
          notificationsResults.removed.length.toString(),
        ],
        [
          'Users with admin exclusions',
          notificationsResults.excluded.length.toString(),
        ],
        [
          'Users in grace period',
          notificationsResults.inGracePeriod.length.toString(),
        ],
        ['Errors encountered', notificationsResults.errors.length.toString()],
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
      if (notificationsResults.notified.length > 0) {
        generateIssueLinkList(
          notificationsResults.notified,
          'Newly Created Notifications',
        );
      }

      if (notificationsResults.reactivated.length > 0) {
        generateIssueLinkList(
          notificationsResults.reactivated,
          'Closed Notifications (Users Became Active)',
        );
      }

      if (notificationsResults.removed.length > 0) {
        generateIssueLinkList(
          notificationsResults.removed,
          'Users Removed (Grace Period Expired)',
        );
      }

      if (notificationsResults.excluded.length > 0) {
        generateIssueLinkList(
          notificationsResults.excluded,
          'Admin Exclusions',
        );
      }

      if (notificationsResults.inGracePeriod.length > 0) {
        generateIssueLinkList(
          notificationsResults.inGracePeriod,
          'Users in Grace Period',
        );
      }

      // If there were any errors, show details
      if (notificationsResults.errors.length > 0) {
        core.summary
          .addHeading('Notification Errors', 4)
          .addRaw(
            'The following errors occurred during notification processing:',
            true,
          );

        notificationsResults.errors.forEach(({ user, error }, index) => {
          core.summary.addRaw(
            `${index + 1}. **${user}**: ${error.message}  `,
            true,
          );
        });
      }
    } else {
      core.info('Notifications are disabled');
    }

    await core.summary.write();

    // Save activity log if repo info is provided
    if (context.activityLog) {
      core.info(
        `Saving activity log to ${activityLogContext.repo.owner}/${activityLogContext.repo.repo}`,
      );

      try {
        const dateStamp = new Date().toISOString().split('T')[0];
        const content = await check.activity.all();

        const contentBase64 = Buffer.from(
          JSON.stringify(content, null, 2),
        ).toString('base64');

        if (!dryRun) {
          // Check if the branch exists
          const branchExists = await checkBranch(context);

          if (!branchExists) {
            core.info(`Creating branch: ${activityLogContext.branchName}`);
            await createBranch(octokit, activityLogContext.repo, check.type);
          } else {
            core.debug(
              `Branch already exists: ${activityLogContext.branchName}`,
            );
          }

          await updateActivityLog(octokit, activityLogContext.repo, {
            branch: activityLogContext.branchName,
            path: activityLogContext.path,
            sha: existingActivityLogSha,
            message: `Update ${check.type} log for ${dateStamp}`,
            content: contentBase64,
          });

          core.info(
            `Activity log saved to ${activityLogContext.repo.owner}/${activityLogContext.repo.repo}/${activityLogContext.path}`,
          );
        } else {
          core.info(
            `Dry run: Activity log would be saved to ${activityLogContext.repo.owner}/${activityLogContext.repo.repo}/${activityLogContext.path}`,
          );
        }
      } catch (error) {
        core.setFailed(
          `Failed to save activity log: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    core.info('Copilot dormancy check completed successfully');

    if (notificationsResults && notificationsResults.errors) {
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
