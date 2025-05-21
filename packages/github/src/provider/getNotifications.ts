import { OctokitClient } from './types';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';

/**
 * Parameters for fetching issues, excluding owner and repo
 */
export type ListIssuesParams = Omit<
  Parameters<OctokitClient['rest']['issues']['listForRepo']>[0],
  'owner' | 'repo'
>;

/**
 * Type for GitHub issue response data
 */
export type GitHubIssue = GetResponseDataTypeFromEndpointMethod<
  OctokitClient['rest']['issues']['listForRepo']
>[number];

/**
 * Interface for getNotifications parameters
 */
export interface GetNotificationsOptions {
  readonly octokit: OctokitClient;
  readonly owner: string;
  readonly repo: string;
  readonly params?: ListIssuesParams;
}

/**
 * Fetch all issues from a GitHub repository with pagination using Octokit's built-in paginate method
 * @param options - Options for fetching notifications
 * @param {GetNotificationsOptions} options.octokit - Octokit client instance
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {ListIssuesParams} [options.params] - Additional query parameters for the GitHub API
 * @returns Array of GitHub issues
 */
export async function getNotifications({
  octokit,
  owner,
  repo,
  params = {},
}: GetNotificationsOptions): Promise<GitHubIssue[]> {
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    per_page: 100,
    ...params,
  });

  console.log(`Fetched ${issues.length} total issues from ${owner}/${repo}`);
  return issues;
}
