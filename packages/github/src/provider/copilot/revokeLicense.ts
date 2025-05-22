import { OctokitClient } from '../types';

const logger = console;

/**
 * Removes a list of users from GitHub Copilot in a given organization.
 *
 * @param logins - The list of users to remove
 * @param octokit - The Octokit instance for making API calls
 * @param org - The organization to remove users from
 * @param dryRun - If true, only logs the actions without executing them
 * @returns A promise that resolves to true if the user(s) were removed, false otherwise
 */
export const revokeCopilotLicense = async ({
  logins,
  octokit,
  org,
  dryRun = false,
}: {
  logins: string | string[];
  octokit: OctokitClient;
  org: string;
  dryRun?: boolean;
}): Promise<boolean> => {
  const selected_usernames = Array.isArray(logins) ? logins : [logins];

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

  // Return true if all requested licenses were successfully revoked
  return seats_cancelled === selected_usernames.length;
};
