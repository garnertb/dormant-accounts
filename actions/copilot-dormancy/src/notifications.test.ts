import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotNotificationContext, processNotifications } from './run';
import {
  GithubIssueNotifier,
  LastActivityRecord,
} from '@dormant-accounts/github';

vi.mock('@actions/core');
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
    GithubIssueNotifier: vi.fn().mockImplementation(function () {
      return {
        processDormantUsers: vi.fn().mockResolvedValue({
          notified: [{ user: 'user1', notification: { id: 1 } }],
          removed: [{ user: 'user2', notification: { id: 2 } }],
          reactivated: [{ user: 'user3', notification: { id: 3 } }],
          excluded: [],
          inGracePeriod: [],
          departed: [],
          skipped: [],
          wouldRemove: [],
          errors: [],
        }),
      };
    }),
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
  const notificationContext: CopilotNotificationContext = {
    repo: {
      owner: 'test-org',
      repo: 'test-repo',
    },
    duration: '7d',
    body: 'Test notification body',
    baseLabels: ['copilot-dormancy'],
    dryRun: false,
    removeDormantAccounts: false,
    allowTeamRemoval: false,
    assignUserToIssue: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create notifier with correct configuration', async () => {
    await processNotifications(
      mockOctokit,
      mockOctokit,
      notificationContext,
      mockDormantAccounts,
      createMockCheckObject(),
      '30d',
      'test-org',
    );

    expect(GithubIssueNotifier).toHaveBeenCalledWith({
      githubClient: mockOctokit,
      gracePeriod: notificationContext.duration,
      assignUserToIssue: true,
      repository: {
        ...notificationContext.repo,
        baseLabels: notificationContext.baseLabels,
      },
      notificationBody: 'Test notification body',
      removeAccount: expect.any(Function),
      dryRun: notificationContext.dryRun,
      dormantAfter: '30d',
    });
  });

  it('should return results from processDormantUsers', async () => {
    const result = await processNotifications(
      mockOctokit,
      mockOctokit,
      notificationContext,
      mockDormantAccounts,
      createMockCheckObject(),
      '30d',
      'test-org',
    );

    expect(result).toEqual({
      notified: [{ user: 'user1', notification: { id: 1 } }],
      removed: [{ user: 'user2', notification: { id: 2 } }],
      reactivated: [{ user: 'user3', notification: { id: 3 } }],
      excluded: [],
      inGracePeriod: [],
      departed: [],
      skipped: [],
      wouldRemove: [],
      errors: [],
    });
  });
});
