import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNotifications } from './getNotifications';

describe('getNotifications', () => {
  const mockIssues = Array(150)
    .fill(0)
    .map((_, i) => ({
      id: i,
      title: `Issue ${i}`,
    }));

  const mockOctokit = {
    paginate: vi.fn().mockResolvedValue(mockIssues),
    rest: {
      issues: {
        listForRepo: vi.fn(),
      },
    },
  };

  const mockOwner = 'testOwner';
  const mockRepo = 'testRepo';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use octokit.paginate to fetch all issues', async () => {
    const result = await getNotifications({
      octokit: mockOctokit as any,
      owner: mockOwner,
      repo: mockRepo,
    });

    expect(result).toBe(mockIssues);
    expect(mockOctokit.paginate).toHaveBeenCalledTimes(1);
    expect(mockOctokit.paginate).toHaveBeenCalledWith(
      mockOctokit.rest.issues.listForRepo,
      {
        owner: mockOwner,
        repo: mockRepo,
        per_page: 100,
      },
    );
  });

  it('should pass additional params to the GitHub API', async () => {
    const params = {
      state: 'open',
      labels: 'bug,enhancement',
      assignee: 'username',
    };

    await getNotifications({
      octokit: mockOctokit as any,
      owner: mockOwner,
      repo: mockRepo,
      params,
    });

    expect(mockOctokit.paginate).toHaveBeenCalledWith(
      mockOctokit.rest.issues.listForRepo,
      {
        owner: mockOwner,
        repo: mockRepo,
        per_page: 100,
        ...params,
      },
    );

    expect(mockOctokit.paginate).toHaveBeenCalledWith(
      mockOctokit.rest.issues.listForRepo,
      {
        owner: mockOwner,
        repo: mockRepo,
        per_page: 100,
        ...params,
      },
    );
  });
});
