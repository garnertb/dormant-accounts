import { OctokitClient } from '../types';
import { getTeamDetails } from './getTeamDetails';

const logger = console;

/**
 * Parameters for removeCopilotUserFromTeam function
 */
export interface RemoveCopilotUserFromTeamParams {
  /** The username of the user to remove from team */
  readonly username: string;
  /** The Octokit instance for making API calls */
  readonly octokit: OctokitClient;
  /** The organization to perform the operation in */
  readonly org: string;
  /** If true, only logs the actions without executing them */
  readonly dryRun?: boolean;
  /** If true, fallback to legacy endpoint if modern endpoint fails (defaults to true) */
  readonly fallbackToLegacy?: boolean;
}

/**
 * Parameters for removeUserFromTeamLegacy function
 */
export interface RemoveUserFromTeamLegacyParams {
  /** The Octokit instance for making API calls */
  readonly octokit: OctokitClient;
  /** The team ID */
  readonly team_id: number;
  /** The username to remove */
  readonly username: string;
}

/**
 * Removes a user from a team using the legacy endpoint
 *
 * This is primarily for compatibility with GitHub Apps that do not support the modern endpoint.
 *
 * @param params - The parameters for removing a user from a team using legacy endpoint
 * @returns Promise that resolves when the user is removed
 */
export const removeUserFromTeamLegacy = async ({
  octokit,
  team_id,
  username,
}: RemoveUserFromTeamLegacyParams): Promise<void> => {
  await octokit.request('DELETE /teams/{team_id}/members/{username}', {
    team_id,
    username,
    headers: {
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
};

/**
 * Parameters for removeUserFromTeamModern function
 */
export interface RemoveUserFromTeamModernParams {
  /** The Octokit instance for making API calls */
  readonly octokit: OctokitClient;
  /** The organization name */
  readonly org: string;
  /** The team slug */
  readonly team_slug: string;
  /** The username to remove */
  readonly username: string;
}

/**
 * Removes a user from a team using the modern endpoint
 *
 * @param params - The parameters for removing a user from a team using modern endpoint
 * @returns Promise that resolves when the user is removed
 */
export const removeUserFromTeamModern = async ({
  octokit,
  org,
  team_slug,
  username,
}: RemoveUserFromTeamModernParams): Promise<void> => {
  await octokit.rest.teams.removeMembershipForUserInOrg({
    org,
    team_slug,
    username,
  });
};

/**
 * Attempts to remove a user from a team that granted them Copilot access.
 * Uses the modern endpoint by default with fallback to legacy endpoint if it fails.
 *
 * @param params - The parameters for removing a user from a Copilot team
 * @returns Promise that resolves to true if the user was successfully removed, false otherwise
 */
export const removeCopilotUserFromTeam = async ({
  username,
  octokit,
  org,
  dryRun = false,
  fallbackToLegacy = true,
}: RemoveCopilotUserFromTeamParams): Promise<boolean> => {
  try {
    const {
      data: { assigning_team },
    } = await octokit.rest.copilot.getCopilotSeatDetailsForUser({
      org,
      username,
    });

    if (!assigning_team) {
      logger.debug(`User ${username} is not assigned to Copilot via a team`);
      return false;
    }

    const { slug: team_slug } = assigning_team;
    const {
      id: teamId,
      slug: teamSlug,
      name: teamName,
      isIdpSynced,
    } = await getTeamDetails({ octokit, org, team_slug });

    logger.debug(
      `User ${username} is assigned to Copilot via team ${teamName} (id: ${teamId})`,
    );

    if (isIdpSynced) {
      logger.info(
        `User ${username} must be removed from team ${teamName} via the IdP to revoke Copilot license`,
      );
      return false;
    }

    if (dryRun) {
      logger.info(
        `DRY RUN: Would remove ${username} from team ${teamName} to revoke Copilot license`,
      );
      return false;
    }

    try {
      await removeUserFromTeamModern({
        octokit,
        org,
        team_slug: teamSlug,
        username,
      });
    } catch (modernError: unknown) {
      if (fallbackToLegacy) {
        logger.debug(
          `Modern endpoint failed for ${username}, falling back to legacy endpoint:`,
          modernError,
        );
        await removeUserFromTeamLegacy({
          octokit,
          team_id: teamId,
          username,
        });
      } else {
        throw modernError;
      }
    }

    logger.info(
      `Successfully removed ${username} from team ${teamName} to revoke Copilot license`,
    );
    return true;
  } catch (error: unknown) {
    logger.error(`Error removing ${username} from team:`, error);
    return false;
  }
};
