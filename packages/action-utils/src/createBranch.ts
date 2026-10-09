import { OctokitClient } from '@dormant-accounts/github';
import * as core from '@actions/core';

/**
 * Creates a new branch in the specified repository.
 * @param octokit - The Octokit client instance.
 * @param context - The context containing the owner and repo information.
 * @param branchName - The name of the new branch to create.
 */
export async function createBranch(
  octokit: OctokitClient,
  context: { owner: string; repo: string },
  branchName: string,
) {
  core.debug(`attempting to create activity log branch: ${branchName}...`);

  // Determine the default branch for the repo
  const repoData = await octokit.rest.repos.get({
    ...context,
  });

  // Fetch the base branch to use its SHA as the parent
  const baseBranch = await octokit.rest.repos.getBranch({
    ...context,
    branch: repoData.data.default_branch,
  });

  // Create the lock branch
  await octokit.rest.git.createRef({
    ...context,
    ref: `refs/heads/${branchName}`,
    sha: baseBranch.data.commit.sha,
  });

  core.info(`📖 created activity log branch: ${branchName}`);
}
