import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processNotifications } from './run';
import * as core from '@actions/core';
import {
  GithubIssueNotifier,
  LastActivityRecord,
} from '@dormant-accounts/github';
import {
  NotificationContext,
  getNotificationContext,
} from './utils/getNotificationContext';

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
    allowTeamRemoval: false,
    assignUserToIssue: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('notification context', () => {
    it('should return false when notifications are disabled (by default)', () => {
      const notificationContext = getNotificationContext();
      expect(notificationContext).toBeFalsy();
    });

    it('should return false when notifications are disabled (by default)', () => {
      vi.mocked(core.getInput).mockImplementation((name) => {
        const inputs: Record<string, string> = {
          'notifications-enabled': 'false',

          'notifications-repo': 'test-owner/test-repo',
          'notifications-duration': '30d',
          'notifications-body': 'Test notification body',
          'notifications-dry-run': 'false',
          'assign-user-to-notification-issue': 'false',
          'remove-dormant-accounts': 'false',
        };
        return inputs[name] || '';
      });

      const notificationContext = getNotificationContext();
      expect(notificationContext).toBeFalsy();
    });

    it('should return correct notification context', () => {
      vi.mocked(core.getInput).mockImplementation((name) => {
        const inputs: Record<string, string> = {
          org: 'test-org',
          'activity-log-repo': 'test-owner/test-repo',
          duration: '90d',
          token: 'mock-token',
          'dry-run': 'false',
          'notifications-enabled': 'true',
          'notifications-repo': 'test-owner/test-repo',
          'notifications-duration': '30d',
          'notifications-body': 'Test notification body',
          'notifications-dry-run': 'false',
          'remove-user-from-assigning-team': 'false',
        };
        return inputs[name] || '';
      });

      const notificationContext = getNotificationContext();
      expect(notificationContext).toEqual({
        repo: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
        assignUserToIssue: true,
        removeDormantAccounts: false,
        allowTeamRemoval: false,
        duration: '30d',
        body: 'Test notification body',
        baseLabels: ['copilot-dormancy'],
        dryRun: false,
      });
    });
  });

  it('should create notifier with correct configuration', async () => {
    await processNotifications(
      mockOctokit,
      notificationContext,
      mockDormantAccounts,
      createMockCheckObject(),
      '30d',
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
      notificationContext,
      mockDormantAccounts,
      createMockCheckObject(),
      '30d',
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
