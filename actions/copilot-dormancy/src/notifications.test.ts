import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processNotifications } from './run';
import {
  GithubIssueNotifier,
  LastActivityRecord,
} from '@dormant-accounts/github';
import { NotificationContext } from './utils/getNotificationContext';

const createMockCheckObject = () => ({
  fetchActivity: vi.fn().mockResolvedValue(undefined),
  listDormantAccounts: vi.fn().mockResolvedValue([{ login: 'dormant-user' }]),
  listActiveAccounts: vi.fn().mockResolvedValue([{ login: 'active-user' }]),
  summarize: vi.fn().mockResolvedValue({
    lastActivityFetch: '2023-01-01T00:00:00.000Z',
    totalAccounts: 2,
    activeAccounts: 1,
    dormantAccounts: 1,
    activeAccountPercentage: 50,
    dormantAccountPercentage: 50,
    duration: '30d',
  }),
  activity: {
    all: vi.fn().mockResolvedValue({
      _state: { lastRun: '2023-01-01T00:00:00.000Z' },
      users: { 'active-user': {}, 'dormant-user': {} },
    }),
    remove: vi.fn(),
  },
});

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
  const mockDormantAccounts: LastActivityRecord[] = [
    { login: 'user1', lastActivity: new Date('2023-01-01'), type: 'user' },
    { login: 'user2', lastActivity: new Date('2023-01-10'), type: 'user' },
    { login: 'user3', lastActivity: new Date('2023-01-20'), type: 'user' },
  ];

  // Create notification context
  const notificationContext: NotificationContext = {
    repo: {
      owner: 'test-org',
      repo: 'test-repo',
    },
    duration: '7d',
    body: 'Test notification body',
    baseLabels: ['copilot-dormancy'],
    dryRun: false,
    removeDormantAccounts: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create notifier with correct configuration', async () => {
    await processNotifications(
      mockOctokit,
      notificationContext,
      mockDormantAccounts,
      createMockCheckObject(),
    );

    expect(GithubIssueNotifier).toHaveBeenCalledWith({
      githubClient: mockOctokit,
      gracePeriod: notificationContext.duration,
      repository: {
        ...notificationContext.repo,
        baseLabels: notificationContext.baseLabels,
      },
      notificationBody: expect.any(Function),
      removeAccount: expect.any(Function),
      dryRun: notificationContext.dryRun,
    });
  });

  it('should return results from processDormantUsers', async () => {
    const result = await processNotifications(
      mockOctokit,
      notificationContext,
      mockDormantAccounts,
      createMockCheckObject(),
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
