import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  copilotDormancy,
  GithubIssueNotifier,
  OctokitClient,
  LastActivityRecord,
} from '@dormant-accounts/github';
import { createBranch } from './utils/createBranch';
import { getActivityLog } from './utils/getActivityLog';
import { writeFile } from 'fs/promises';
import { checkBranch } from './utils/checkBranch';

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

export async function processNotifications(
  octokit: OctokitClient,
  notificationDuration: string,
  notificationRepoOrg: string,
  notificationRepo: string,
  checkType: string,
  notificationBody: string,
  dryRun: boolean,
  dormantAccounts: LastActivityRecord[],
) {
  const notifier = new GithubIssueNotifier({
    githubClient: octokit,
    gracePeriod: notificationDuration,
    repository: {
      owner: notificationRepoOrg,
      repo: notificationRepo,
      baseLabels: [checkType],
    },
    notificationBody: notificationBody,
    dryRun,
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

    // Get notification inputs
    const sendNotifications = core.getInput('notifications-enabled') === 'true';
    const notificationRepoOrg = core.getInput('notifications-repo-org');
    const notificationRepo = core.getInput('notifications-repo');
    const notificationDuration = core.getInput('notifications-duration');
    const notificationBody = core.getInput('notifications-body');
    const checkType = 'copilot-dormancy';
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
        `Notifications enabled with grace period: ${notificationDuration}`,
      );
      core.info(
        `Notification repository: ${notificationRepoOrg}/${notificationRepo}`,
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
      await writeFile(activityLogContext.path, activityLog);
      core.info(`Activity log fetched and saved to ${activityLogContext.path}`);
    } else {
      core.info('Activity log does not exist, creating new one...');
    }

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

          await octokit.rest.repos.createOrUpdateFileContents({
            owner: owner as string,
            repo: repo as string,
            branch: branchName,
            path: activityLogContext.path,
            message: `Update Copilot dormancy log for ${dateStamp}`,
            content: contentBase64,
            committer: {
              name: 'GitHub Action',
              email: 'action@github.com',
            },
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

    // Send notifications if enabled
    if (sendNotifications) {
      const notifications = await processNotifications(
        octokit,
        notificationDuration,
        notificationRepoOrg,
        notificationRepo,
        checkType,
        notificationBody,
        dryRun,
        dormantAccounts,
      );

      core.setOutput('notification-results', safeStringify(notifications));

      core.info(
        `Created notifications for ${notifications.notified} dormant accounts`,
      );
      core.info(
        `Closed notifications for ${notifications.reactivated} no longer dormant accounts`,
      );
      core.info(`Removed ${notifications.removed} dormant accounts`);
    } else {
      core.info('Notifications are disabled');
    }

    core.info('Copilot dormancy check completed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed with error: ${errorMessage}`);
    core.setOutput('error', errorMessage);
    throw error; // Rethrow the error to ensure the action fails
  }
}

run();

// For testing purposes, export the run function
export { run };
