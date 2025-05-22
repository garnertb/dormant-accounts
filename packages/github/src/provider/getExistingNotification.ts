import { OctokitClient } from './types';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';
import { getNotifications } from './getNotifications';

/**
 * Interface representing a notification issue retrieved via GraphQL API
 */
export interface NotificationIssue
  extends GetResponseDataTypeFromEndpointMethod<
    OctokitClient['rest']['issues']['create']
  > {}

/**
 * Configuration for retrieving existing notifications
 */
export interface GetExistingNotificationOptions {
  /**
   * The Octokit client instance
   */
  octokit: OctokitClient;
  /**
   * Repository owner
   */
  owner: string;
  /**
   * Repository name
   */
  repo: string;
  /**
   * Username to search for
   */
  username: string;
  /**
   * Base labels to include in search
   */
  baseLabels: string[];
  /**
   * Whether to include assignee in search criteria
   */
  assignUserToIssue?: boolean;
}

/**
 * Retrieves an existing notification issue for a user using GitHub's GraphQL API
 *
 * @param options - Options for retrieving the notification
 * @returns The notification issue if found, or null if not found
 */
export async function getExistingNotification(
  options: GetExistingNotificationOptions,
): Promise<NotificationIssue | null> {
  const { octokit, owner, repo, username, baseLabels, assignUserToIssue } =
    options;

  // Construct the GraphQL query
  const repoQuery = `repo:${owner}/${repo}`;
  const titleQuery = `in:title ${username}`;
  // could also consider searching for mention in body: mentions:${username}
  const stateQuery = 'state:open';
  const sortQuery = 'sort:created-asc';

  // Build label query from base labels
  const labelQuery = baseLabels.map((label) => `label:"${label}"`).join(' ');

  // Add assignee filter if enabled
  const assigneeQuery = assignUserToIssue ? `assignee:${username}` : '';

  // Combine all query parts, filtering out empty strings
  const searchQuery = [
    repoQuery,
    titleQuery,
    stateQuery,
    labelQuery,
    assigneeQuery,
    sortQuery,
  ]
    .filter(Boolean)
    .join(' ');

  try {
    // Execute GraphQL query
    const response = await octokit.graphql<{
      search: {
        nodes: Array<{
          number: number;
          title: string;
          url: string;
          createdAt: string;
          state: string;
          labels?: {
            nodes: Array<{
              name: string;
            }>;
          };
        }>;
      };
    }>(
      `
      query GetExistingNotification($searchQuery: String!) {
        search(query: $searchQuery, type: ISSUE, first: 50) {
          nodes {
            ... on Issue {
              number
              title
              url
              createdAt
              state
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
      }
    `,
      {
        searchQuery,
      },
    );

    console.debug(
      `Found ${response.search.nodes.length} issues matching query: ${searchQuery}`,
    );

    // Find the issue with exact title match
    const issueNode = response.search.nodes.find(
      (node) => node.title === username,
    );

    if (!issueNode) {
      return null;
    }

    // Transform the GraphQL response to match the REST API format
    const issue: NotificationIssue = {
      number: issueNode.number,
      title: issueNode.title,
      html_url: issueNode.url,
      created_at: issueNode.createdAt,
      state: issueNode.state,
      // Transform labels to match the expected format
      labels:
        issueNode.labels?.nodes.map((label) => ({ name: label.name })) || [],
    } as NotificationIssue;

    return issue;
  } catch (error) {
    console.error('Error fetching existing notification via GraphQL:', error);
    // Fall back to REST API if GraphQL fails
    console.log('Falling back to REST API for fetching notification');
    return fallbackToRestApi(options);
  }
}

/**
 * Fallback method using REST API to get existing notification
 * This is used when GraphQL API call fails
 *
 * @param options - Options for retrieving the notification
 * @returns The notification issue if found, or null if not found
 */
async function fallbackToRestApi(
  options: GetExistingNotificationOptions,
): Promise<NotificationIssue | null> {
  const { octokit, owner, repo, username, baseLabels, assignUserToIssue } =
    options;

  const issues = await getNotifications({
    octokit,
    owner,
    repo,
    params: {
      state: 'open',
      labels: baseLabels.join(','),
      assignee: assignUserToIssue ? username : undefined,
    },
  });

  return (
    (issues.find((issue) => issue.title === username) as NotificationIssue) ||
    null
  );
}
