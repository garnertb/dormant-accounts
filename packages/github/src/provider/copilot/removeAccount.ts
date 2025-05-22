import type { RemoveUserHandler } from 'dormant-accounts';
import { GitHubHandlerConfig } from '../types';
import { revokeCopilotLicense } from './revokeLicense';

/**
 * Remove user handler meant to be configured as part of a dormancy check.
 *
 * @param login - The user login to remove
 * @param octokit - The Octokit instance for making API calls
 * @param org - The organization to remove users from
 * @param dryRun - If true, only logs the actions without executing them
 * @returns A promise that resolves to true if the user was removed, false otherwise
 */
export const removeAccount: RemoveUserHandler<
  GitHubHandlerConfig,
  boolean
> = async ({ login, octokit, org, dryRun }) => {
  return revokeCopilotLicense({
    logins: login,
    octokit,
    org,
    dryRun: dryRun === true,
  });
};
