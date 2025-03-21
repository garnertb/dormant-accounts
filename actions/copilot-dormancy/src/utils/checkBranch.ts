import * as core from '@actions/core';
import { OctokitClient } from '@dormant-accounts/github';

/**
 * Checks if a branch exists in the specified repository.
 * @param octokit - The Octokit client instance.
 * @param context - The context containing the owner and repo information.
 * @param branchName - The name of the branch to check.
 * @returns A promise that resolves to true if the branch exists, false otherwise.
 */
export async function checkBranch(
  octokit: OctokitClient,
  context: { owner: string; repo: string },
  branchName: string,
): Promise<{ name: string; commit: { sha: string } } | boolean> {
  core.debug(`checking if branch ${branchName} exists...`);
  // Check if the activity log branch already exists
  try {
    const { data } = await octokit.rest.repos.getBranch({
      ...context,
      branch: branchName,
    });
    // If the branch exists, return true
    core.debug(`branch '${branchName}' exists`);
    return data;
  } catch (error: any) {
    core.debug(`checkBranch() error.status: ${error.status}`);
    // Check if the error was due to the activity log branch not existing
    if (error.status === 404) {
      core.debug(`activity log branch ${branchName} does not exist`);
      return false;
    } else {
      core.error(
        'an unexpected status code was returned while checking for the activity log branch',
      );
      throw new Error(error);
    }
  }
}
