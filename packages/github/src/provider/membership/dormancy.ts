import { dormancyCheck } from 'dormant-accounts';
import { defaultWhitelistHandler } from '../audit-log';
import { fetchMembershipActivity } from './fetchMembershipActivity';
import type { GitHubMembershipArgs, GitHubMembershipConfig } from './types';

/**
 * Creates a dormancy check for organization members (and optionally outside
 * collaborators) based on audit log activity, plus Copilot seat activity and
 * notification comments when enabled. Owners are never checked.
 *
 * Every run stores a complete snapshot merged with the `latest` strategy, so a
 * stored date is only replaced by a newer one and departed accounts are pruned.
 * The first-seen baseline is enabled by default.
 *
 * @param config - The configuration object for the dormancy check
 * @returns A dormancy check for organization membership inactivity
 */
export const githubMembershipDormancy = (config: GitHubMembershipArgs) => {
  const {
    type = 'github-dormancy',
    isWhitelisted = defaultWhitelistHandler,
    fetchLatestActivity = fetchMembershipActivity,
    firstSeenBaseline = true,
    ...rest
  } = config;

  return dormancyCheck<GitHubMembershipConfig>({
    type,
    ...rest,
    activityResultType: 'complete',
    activityMergeStrategy: 'latest',
    firstSeenBaseline,
    fetchLatestActivity,
    isWhitelisted,
  });
};
