import { describe, expect, it, vi } from 'vitest';
import { createFakeOctokit, type FakeOctokitData } from './fakeOctokit';
import {
  fetchNotificationCommentActivity,
  NOTIFICATION_COMMENT_ACTIVITY_TYPE,
} from './fetchNotificationCommentActivity';

const logger = { debug: vi.fn() };

const issue = (
  number: number,
  title: string,
  created_at: string,
  labels = ['github-dormancy'],
) => ({ number, title, created_at, labels });

const run = (data: FakeOctokitData) => {
  const octokit = createFakeOctokit(data);
  const result = fetchNotificationCommentActivity({
    octokit: octokit as any,
    owner: 'acme',
    repo: 'notifications',
    baseLabels: ['github-dormancy'],
    logger: logger as any,
  });
  return { octokit, result };
};

describe('fetchNotificationCommentActivity', () => {
  it("counts a user's comment on their own notification issue", async () => {
    const { result } = run({
      issues: [issue(1, 'Alice', '2025-06-01T00:00:00Z')],
      repoComments: [
        { issue_number: 1, login: 'alice', created_at: '2025-06-02T00:00:00Z' },
        { issue_number: 1, login: 'ALICE', created_at: '2025-06-05T00:00:00Z' },
      ],
    });

    await expect(result).resolves.toEqual([
      {
        login: 'alice',
        lastActivity: new Date('2025-06-05T00:00:00Z'),
        type: NOTIFICATION_COMMENT_ACTIVITY_TYPE,
      },
    ]);
  });

  it("ignores another user's comment", async () => {
    const { result } = run({
      issues: [
        issue(1, 'alice', '2025-06-01T00:00:00Z'),
        issue(2, 'bob', '2025-06-01T00:00:00Z'),
      ],
      repoComments: [
        { issue_number: 1, login: 'bob', created_at: '2025-06-02T00:00:00Z' },
        {
          issue_number: 2,
          login: 'admin-user',
          created_at: '2025-06-02T00:00:00Z',
        },
      ],
    });

    await expect(result).resolves.toEqual([]);
  });

  it('ignores the same title under another label', async () => {
    const { result } = run({
      issues: [issue(1, 'alice', '2025-06-01T00:00:00Z', ['copilot-dormancy'])],
      repoComments: [
        { issue_number: 1, login: 'alice', created_at: '2025-06-02T00:00:00Z' },
      ],
    });

    await expect(result).resolves.toEqual([]);
  });

  it('ignores closed issues and pull requests', async () => {
    const { result } = run({
      issues: [
        { ...issue(1, 'alice', '2025-06-01T00:00:00Z'), state: 'closed' },
        {
          ...issue(2, 'bob', '2025-06-01T00:00:00Z'),
          pull_request: { url: 'https://example.test/pull/2' },
        },
      ],
      repoComments: [
        { issue_number: 1, login: 'alice', created_at: '2025-06-02T00:00:00Z' },
        { issue_number: 2, login: 'bob', created_at: '2025-06-02T00:00:00Z' },
      ],
    });

    await expect(result).resolves.toEqual([]);
  });

  it('reads comments since the oldest open notification issue', async () => {
    const { octokit, result } = run({
      issues: [
        issue(1, 'alice', '2025-06-10T00:00:00Z'),
        issue(2, 'bob', '2025-05-01T00:00:00Z'),
      ],
    });

    await result;

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.rest.issues.listCommentsForRepo,
      expect.objectContaining({
        owner: 'acme',
        repo: 'notifications',
        since: '2025-05-01T00:00:00Z',
      }),
    );
  });

  it('does not list comments when there are no open notification issues', async () => {
    const { octokit, result } = run({ issues: [] });

    await expect(result).resolves.toEqual([]);
    expect(octokit.paginate).not.toHaveBeenCalledWith(
      octokit.rest.issues.listCommentsForRepo,
      expect.anything(),
    );
  });
});
