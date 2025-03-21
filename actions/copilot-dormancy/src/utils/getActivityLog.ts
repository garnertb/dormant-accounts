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

    const activityLog = Buffer.from(
      // @ts-ignore
      data?.content,
      'base64',
    ).toString('utf8');

    // @ts-ignore
    return { content: activityLog, sha: data?.sha };
  } catch (error: any) {
    core.error(`getActivityLog() error: ${error}`);
    core.debug(`getActivityLog() error.status: ${error.status}`);
    // If the activity log doesn't exist, return false
    if (error.status === 404) {
      core.info(`🔍 activity log does not exist on branch: ${branchName}`);
      return false;
    }

    // If some other error occurred, throw it
    throw new Error(error);
  }
}
