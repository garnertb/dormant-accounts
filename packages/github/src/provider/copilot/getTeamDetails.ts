import { OctokitClient } from '../types';
import { isTeamIdpSynced } from './isTeamIdpSynced';

/**
 * Cached team data to prevent unnecessary API calls
 */
interface TeamData {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly isIdpSynced: boolean;
}

/**
 * Cache for team data lookups
 */
const teamDataCache = new Map<string, TeamData>();

/**
 * Gathers team data including ID, slug, name, and IdP sync status with caching
 *
 * @param octokit - The Octokit instance for making API calls
 * @param org - The organization name
 * @param team_slug - The team slug
 * @returns Promise resolving to team data with IdP sync status
 */
export const getTeamDetails = async (
  octokit: OctokitClient,
  org: string,
  team_slug: string,
): Promise<TeamData> => {
  const cacheKey = `${org}/${team_slug}`;

  if (teamDataCache.has(cacheKey)) {
    return teamDataCache.get(cacheKey)!;
  }

  const {
    data: { id, slug, name },
  } = await octokit.rest.teams.getByName({
    org,
    team_slug,
  });

  const isIdpSynced = await isTeamIdpSynced({ octokit, org, team_slug });

  const teamData: TeamData = {
    id,
    slug,
    name,
    isIdpSynced,
  };

  teamDataCache.set(cacheKey, teamData);
  return teamData;
};

/**
 * Clears the team data cache. Useful for testing.
 */
export const clearTeamDataCache = (): void => {
  teamDataCache.clear();
};

export type { TeamData };
