import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processNotifications } from './index';
import {
  GithubIssueNotifier,
  LastActivityRecord,
} from '@dormant-accounts/github';

// Mock GithubIssueNotifier
vi.mock('@dormant-accounts/github', async () => {
  const actual = await vi.importActual('@dormant-accounts/github');
  return {
    ...actual,
    GithubIssueNotifier: vi.fn().mockImplementation(() => ({
      processDormantUsers: vi.fn().mockResolvedValue({
        notified: [{ user: 'user1', notification: { id: 1 } }],
        removed: [{ user: 'user2', notification: { id: 2 } }],
        reactivated: [{ user: 'user3', notification: { id: 3 } }],
        excluded: [],
        inGracePeriod: [],
        errors: [],
      }),
    })),
  };
});

describe('Notification Processing', () => {
  const mockOctokit = {} as any;
  const notificationDuration = '7d';
  const notificationRepoOrg = 'test-org';
  const notificationRepo = 'test-repo';
  const checkType = 'copilot-dormancy';
  const notificationBody = 'Test notification body';

  const mockDormantAccounts: LastActivityRecord[] = [
    { login: 'user1', lastActivity: new Date('2023-01-01'), type: 'user' },
    { login: 'user2', lastActivity: new Date('2023-01-10'), type: 'user' },
    { login: 'user3', lastActivity: new Date('2023-01-20'), type: 'user' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create notifier with correct configuration', async () => {
    await processNotifications(
      mockOctokit,
      notificationDuration,
      notificationRepoOrg,
      notificationRepo,
      checkType,
      notificationBody,
      false,
      mockDormantAccounts,
    );

    expect(GithubIssueNotifier).toHaveBeenCalledWith({
      githubClient: mockOctokit,
      gracePeriod: notificationDuration,
      repository: {
        owner: notificationRepoOrg,
        repo: notificationRepo,
        baseLabels: [checkType],
      },
      notificationBody: notificationBody,
      dryRun: false,
    });
  });

  it('should return results from processDormantUsers', async () => {
    const result = await processNotifications(
      mockOctokit,
      notificationDuration,
      notificationRepoOrg,
      notificationRepo,
      checkType,
      notificationBody,
      false,
      mockDormantAccounts,
    );

    expect(result).toEqual({
      notified: [{ user: 'user1', notification: { id: 1 } }],
      removed: [{ user: 'user2', notification: { id: 2 } }],
      reactivated: [{ user: 'user3', notification: { id: 3 } }],
      excluded: [],
      inGracePeriod: [],
      errors: [],
    });
  });
});
