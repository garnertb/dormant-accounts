import * as core from '@actions/core';
import { OctokitClient } from '@dormant-accounts/github';

/**
 * Fetches the activity log from the specified branch.
 * @param octokit - The Octokit client instance.
 * @param context - The context containing the owner and repo information.
 * @param branchName - The name of the new branch to create.
 */
export async function getActivityLog(
  octokit: OctokitClient,
  context: { owner: string; repo: string },
  branchName: string,
  path: string,
): Promise<{ content: string; sha: string } | false> {
  core.debug(`checking if activity log exists on branch: ${branchName}`);
  core.debug(`checking if activity log exists on path: ${path}`);

  // If the activity log branch exists, check if the activity log file exists
  try {
    // Get the activity log file contents
    const { data } = await octokit.rest.repos.getContent({
      ...context,
      path,
      ref: branchName,
    });
    const file = data as { content: string; sha: string };

    const activityLog = Buffer.from(file.content, 'base64').toString('utf8');

    return { content: activityLog, sha: file.sha };
  } catch (error) {
    core.error(`getActivityLog() error: ${error}`);
    const { status } = error as { status?: number };
    core.debug(`getActivityLog() error.status: ${status}`);
    // If the activity log doesn't exist, return false
    if (status === 404) {
      core.info(`🔍 activity log does not exist on branch: ${branchName}`);
      return false;
    }

    // If some other error occurred, throw it
    throw new Error(String(error), { cause: error });
  }
}
