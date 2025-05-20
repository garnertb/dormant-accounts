import { OctokitClient } from './types';
import { isTeamIdpSynced } from './isTeamIdpSynced';

const logger = console;

/**
 * Parameters for removeCopilotUserFromTeam function
 */

export interface RemoveCopilotUserFromTeamParams {
  /** The username of the user to remove from team */
  username: string;
  /** The Octokit instance for making API calls */
  octokit: OctokitClient;
  /** The organization to perform the operation in */
  org: string;
  /** If true, only logs the actions without executing them */
  dryRun?: boolean;
}

/**
 * Attempts to remove a user from a team that granted them Copilot access.
 * This function implements the logic to check if the team is IdP synced and handle the removal accordingly.
 *
 * @param params - The parameters for removing a user from a Copilot team
 * @returns A promise that resolves to true if the user was successfully removed, false otherwise
 */
export const removeCopilotUserFromTeam = async ({
  username,
  octokit,
  org,
  dryRun = false,
}: RemoveCopilotUserFromTeamParams): Promise<boolean> => {
  try {
    // Get the copilot seat details for the user
    const {
      data: { assigning_team },
    } = await octokit.rest.copilot.getCopilotSeatDetailsForUser({
      org,
      username,
    });

    // Check if the license was assigned by a team
    if (!assigning_team) {
      logger.debug(`User ${username} is not assigned to Copilot via a team`);
      return false;
    }

    const { id, name, slug: team_slug } = assigning_team;

    logger.debug(
      `User ${username} is assigned to Copilot via team ${name} (id: ${id})`,
    );

    // If the team is IdP synced, the user needs to be removed from the team in the IdP
    if (await isTeamIdpSynced({ octokit, org, team_slug })) {
      logger.info(
        `User ${username} must be removed from team ${name} via the IdP to revoke Copilot license`,
      );
      return false;
    }

    // In dry run mode, just log what would have happened
    if (dryRun) {
      logger.info(
        `DRY RUN: Would remove ${username} from team ${name} to revoke Copilot license`,
      );
      return false;
    }

    // Remove the user from the team
    await octokit.rest.teams.removeMembershipForUserInOrg({
      org,
      team_slug,
      username,
    });

    logger.info(
      `Successfully removed ${username} from team ${team_slug} to revoke Copilot license`,
    );
    return true;
  } catch (error: any) {
    logger.error(`Error removing ${username} from team:`, error);
    return false;
  }
};
