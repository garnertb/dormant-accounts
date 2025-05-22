import { dormancyCheck } from 'dormant-accounts';
import { GitHubHandlerArgs, GitHubHandlerConfig } from '../types';
import { fetchLatestActivityFromCopilot } from './fetchLatestActivityFromCopilot';

/**
 * Configures a dormancy check for GitHub user inactivity based on Copilot usage.
 *
 * @param config - The configuration object for the dormancy check
 * @returns A dormancy check function configured for GitHub user inactivity
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
