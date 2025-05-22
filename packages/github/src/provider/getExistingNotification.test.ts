import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getExistingNotification,
  NotificationIssue,
} from './getExistingNotification';
import { OctokitClient } from './types';
import * as notificationsModule from './getNotifications';

describe('getExistingNotification', () => {
  let mockOctokit: any;

  beforeEach(() => {
    mockOctokit = {
      graphql: vi.fn(),
      paginate: vi.fn(),
      rest: {
        issues: {
          listForRepo: vi.fn(),
        },
      },
    };

    // Reset getNotifications mock
    vi.spyOn(notificationsModule, 'getNotifications').mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return null when no issue is found via GraphQL', async () => {
    // Mock GraphQL response with no matching issues
    mockOctokit.graphql.mockResolvedValueOnce({
      search: {
        nodes: [],
      },
    });

    const result = await getExistingNotification({
      octokit: mockOctokit as unknown as OctokitClient,
      owner: 'testOwner',
      repo: 'testRepo',
      username: 'testUser',
      baseLabels: ['test-label'],
      assignUserToIssue: true,
    });

    expect(result).toBeNull();
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);

    // Assert safely that the GraphQL query is correct
    const mockCalls = mockOctokit.graphql.mock.calls;
    if (mockCalls.length > 0 && mockCalls[0].length > 0) {
      const graphqlQuery = mockCalls[0][0];
      expect(typeof graphqlQuery).toBe('string');
      expect(graphqlQuery).toContain('query GetExistingNotification');
    } else {
      // This assertion will fail if the mock wasn't called
      expect(mockCalls.length).toBeGreaterThan(0);
    }
  });

  it('should return issue when found via GraphQL', async () => {
    // Mock GraphQL response with a matching issue
    mockOctokit.graphql.mockResolvedValueOnce({
      search: {
        nodes: [
          {
            number: 123,
            title: 'testUser',
            url: 'https://github.com/testOwner/testRepo/issues/123',
            createdAt: '2023-01-01T00:00:00Z',
            state: 'open',
            labels: {
              nodes: [{ name: 'test-label' }, { name: 'pending-removal' }],
            },
          },
        ],
      },
    });

    const result = await getExistingNotification({
      octokit: mockOctokit as unknown as OctokitClient,
      owner: 'testOwner',
      repo: 'testRepo',
      username: 'testUser',
      baseLabels: ['test-label'],
      assignUserToIssue: false,
    });

    expect(result).not.toBeNull();
    expect(result?.number).toBe(123);
    expect(result?.title).toBe('testUser');
    expect(result?.created_at).toBe('2023-01-01T00:00:00Z');
    expect(result?.labels).toHaveLength(2);
    expect(result?.labels[0]).toHaveProperty('name', 'test-label');
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it('should fall back to REST API when GraphQL fails', async () => {
    // Mock GraphQL error
    mockOctokit.graphql.mockRejectedValueOnce(new Error('GraphQL error'));

    // Mock getNotifications function
    vi.spyOn(notificationsModule, 'getNotifications').mockResolvedValueOnce([
      {
        number: 123,
        title: 'testUser',
        html_url: 'https://github.com/testOwner/testRepo/issues/123',
        created_at: '2023-01-01T00:00:00Z',
        state: 'open',
        labels: [{ name: 'test-label' }],
      } as unknown as NotificationIssue,
    ]);

    const result = await getExistingNotification({
      octokit: mockOctokit as unknown as OctokitClient,
      owner: 'testOwner',
      repo: 'testRepo',
      username: 'testUser',
      baseLabels: ['test-label'],
      assignUserToIssue: true,
    });

    expect(result).not.toBeNull();
    expect(result?.number).toBe(123);
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
    expect(notificationsModule.getNotifications).toHaveBeenCalledTimes(1);

    // Verify getNotifications was called with the correct parameters
    expect(notificationsModule.getNotifications).toHaveBeenCalledWith({
      octokit: mockOctokit,
      owner: 'testOwner',
      repo: 'testRepo',
      params: {
        state: 'open',
        labels: 'test-label',
        assignee: 'testUser',
      },
    });
  });

  it('should construct the correct search query with all options', async () => {
    mockOctokit.graphql.mockResolvedValueOnce({
      search: {
        nodes: [],
      },
    });

    await getExistingNotification({
      octokit: mockOctokit as unknown as OctokitClient,
      owner: 'testOwner',
      repo: 'testRepo',
      username: 'testUser',
      baseLabels: ['dormant', 'user-notification'],
      assignUserToIssue: true,
    });

    // Assert safely on the GraphQL query parameters
    const mockCalls = mockOctokit.graphql.mock.calls;
    if (mockCalls.length > 0 && mockCalls[0].length > 1) {
      const searchQueryArg = mockCalls[0][1]?.searchQuery;
      if (searchQueryArg) {
        // Check that all parts of the query are included
        expect(searchQueryArg).toContain('repo:testOwner/testRepo');
        expect(searchQueryArg).toContain('in:title testUser');
        expect(searchQueryArg).toContain('state:open');
        expect(searchQueryArg).toContain('label:"dormant"');
        expect(searchQueryArg).toContain('label:"user-notification"');
        expect(searchQueryArg).toContain('assignee:testUser');
      } else {
        expect(searchQueryArg).toBeDefined();
      }
    } else {
      // This assertion will fail if the mock wasn't called with the right arguments
      expect(mockCalls.length).toBeGreaterThan(0);
      if (mockCalls.length > 0) {
        expect(mockCalls[0].length).toBeGreaterThan(1);
      }
    }
  });
});
