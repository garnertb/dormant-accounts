import type { OctokitClient } from '../types';

const logger = console;

/**
 * Parameters for the isTeamIdpSynced function
 */
export interface IsTeamIdpSyncedParams {
  /** The Octokit instance for making API calls */
  octokit: OctokitClient;
  /** The organization containing the team */
  org: string;
  /** The slug of the team to check */
  team_slug: string;
}

/**
 * Checks if a team is synchronized with an Identity Provider (IdP).
 *
 * @param params - The parameters for checking team IdP synchronization
 * @returns A promise that resolves to a boolean indicating whether the team is IdP synced
 * @throws Will throw an error if the API call fails for any reason other than a 404 response
 */
export async function isTeamIdpSynced({
  octokit,
  org,
  team_slug,
}: IsTeamIdpSyncedParams): Promise<boolean> {
  try {
    // Check if the team is IdP synced by looking for group mappings
    // This uses the GitHub API endpoint: /organizations/{org_id}/team/{team_id}/team-sync/group-mapping
    const {
      data: { groups = [] },
    } = await octokit.request(
      'GET /orgs/{org}/teams/{team_slug}/team-sync/group-mappings',
      {
        org,
        team_slug,
      },
    );

    // If we get a successful response with groups, the team is IdP synced
    if (groups.length > 0) {
      logger.debug(
        `Team ${team_slug} is IdP synced with ${groups.length} group mappings`,
      );
      return true;
    }

    // No group mappings found, team is not IdP synced
    logger.debug(`Team ${team_slug} is not IdP synced.`);
    return false;
  } catch (error: any) {
    // Any other error should be logged and thrown
    logger.error(
      `Error checking IdP sync status for team ${team_slug}:`,
      error,
    );
    throw error;
  }
}
