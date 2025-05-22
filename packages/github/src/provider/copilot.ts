import { dormancyCheck } from 'dormant-accounts';
import type { RemoveUserHandler } from 'dormant-accounts';
import { GitHubHandlerConfig, GitHubHandlerArgs, OctokitClient } from './types';
import { fetchLatestActivityFromCopilot } from './fetchLatestActivityFromCopilot';

const logger = console;

/**
 * Remove user handler meant to be configured as part of a dormancy check.
 *
 * @param octokit - The Octokit instance for making API calls.
 * @param org - The organization to remove users from.
 * @param accounts - The list of users to remove.
 * @param dryRun - If true, only logs the actions without executing them.
 * @returns A promise true if the user was removed, false otherwise.
 *
 */
export const removeAccount: RemoveUserHandler<
  GitHubHandlerConfig,
  boolean
> = async ({ login, octokit, org, dryRun }) => {
  return revokeCopilotLicense({
    logins: login,
    octokit,
    org,
    dryRun: dryRun == true,
  });
};

/**
 * Removes a list of users from GitHub Copilot in a given organization.
 *
 * @param logins - The list of users to remove.
 * @param octokit - The Octokit instance for making API calls.
 * @param org - The organization to remove users from.
 * @param dryRun - If true, only logs the actions without executing them.
 * @returns A promise `true` if the user(s) were removed, `false` otherwise.
 */
export const revokeCopilotLicense = async (config: {
  logins: string | string[];
  octokit: OctokitClient;
  org: string;
  dryRun?: boolean;
}) => {
  const { octokit, org, logins, dryRun } = config;

  let selected_usernames = logins;

  if (typeof selected_usernames === 'string') {
    selected_usernames = [selected_usernames];
  }

  if (dryRun) {
    logger.info(`DRY RUN: Removing ${selected_usernames} from ${org}`);
    return false;
  }

  const {
    data: { seats_cancelled },
  } = await octokit.rest.copilot.cancelCopilotSeatAssignmentForUsers({
    org,
    selected_usernames,
  });
  logger.info(`Removed ${seats_cancelled} license from ${org}`);

  // todo: need to think about what true/false means in the context of
  // more than one user, however for now, all actual uses of this function are
  // for a single user
  return seats_cancelled === selected_usernames.length;
};

/**
 * Configures a dormancy check for GitHub user inactivity based on Copilot usage.
 *
 * @param config  - The configuration object for the dormancy check.
 *
 * @returns A dormancy check function configured for GitHub user inactivity.
 */
export const copilotDormancy = (config: GitHubHandlerArgs) => {
  const {
    type = 'github-copilot-dormancy',
    fetchLatestActivity = fetchLatestActivityFromCopilot,
    ...rest
  } = config;

  return dormancyCheck<GitHubHandlerConfig>({
    type,
    activityResultType: 'complete',
    ...rest,
    fetchLatestActivity,
  });
};
