import { OctokitClient } from '@dormant-accounts/github';
import * as core from '@actions/core';

/**
 * Updates or creates a file in the specified repository.
 * @param octokit - The Octokit client instance.
 * @param context - The context containing the owner and repo information.
 * @param options - The options for creating or updating the file.
 * @returns The result of the file update operation.
 */
export async function updateActivityLog(
  octokit: OctokitClient,
  context: { owner: string; repo: string },
  options: {
    branch: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
  },
) {
  try {
    core.debug(`Updating activity log file at ${options.path}...`);

    const result = await octokit.rest.repos.createOrUpdateFileContents({
      ...context,
      branch: options.branch,
      path: options.path,
      sha: options.sha,
      message: options.message,
      content: options.content,
      committer: {
        name: 'GitHub Action',
        email: 'action@github.com',
      },
    });

    core.info(`✅ Activity log updated at ${options.path}`);
    return result.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to update activity log: ${errorMessage}`);
    throw error;
  }
}
