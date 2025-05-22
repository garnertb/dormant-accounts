import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GithubIssueNotifier,
  NotificationConfig,
  NotificationStatus,
} from './notifier';
import { NotificationIssue } from './getExistingNotification';
import { LastActivityRecord } from 'dormant-accounts';

describe('GithubIssueNotifier', () => {
  let mockOctokit: any;
  let notifier: GithubIssueNotifier;

  const createNotifier = (options?: Partial<NotificationConfig>) => {
    const defaults = {
      githubClient: mockOctokit,
      gracePeriod: '7d',
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
        baseLabels: ['dormant-account'],
      },
      notificationBody: 'Test notification body',
      dryRun: false,
    };
    return new GithubIssueNotifier({
      ...defaults,
      ...options,
    });
  };

  const createMockOctokit = () => ({
    paginate: vi.fn().mockImplementation(async (endpoint, params) => {
      const result = await endpoint(params);
      return result.data;
    }),
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 123,
            number: 1,
            title: 'test-user',
            created_at: new Date().toISOString(),
            labels: [{ name: 'pending-removal' }],
            state: 'open',
          },
        }),
        listForRepo: vi.fn().mockResolvedValue({
          data: [],
        }),
        createComment: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      orgs: {
        removeMembershipForUser: vi.fn().mockResolvedValue({}),
      },
    },
  });

  beforeEach(() => {
    mockOctokit = createMockOctokit();

    notifier = createNotifier();
  });

  describe('constructor', () => {
    it('initializes with provided configuration', () => {
      expect(notifier).toBeInstanceOf(GithubIssueNotifier);
    });
  });

  describe('notifyUser', () => {
    it('creates an issue for dormant user', async () => {
      const user: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      const result = await notifier.notifyUser(user);

      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'test-user',
        body: expect.stringContaining('@test-user'),
        labels: ['dormant-account', NotificationStatus.PENDING],
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 123,
          number: 1,
          title: 'test-user',
        }),
      );
    });

    it('assignes the dormant user if configured', async () => {
      const user: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      const notifier = createNotifier({
        assignUserToIssue: true,
      });

      const result = await notifier.notifyUser(user);

      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'test-user',
        body: expect.stringContaining('@test-user'),
        labels: ['dormant-account', NotificationStatus.PENDING],
        assignees: ['test-user'],
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 123,
          number: 1,
          title: 'test-user',
        }),
      );
    });

    it('uses function-based notification body when provided', async () => {
      // Create notifier with function-based body
      const functionNotifier = new GithubIssueNotifier({
        githubClient: mockOctokit,
        gracePeriod: '7d',
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
          baseLabels: ['dormant-account'],
        },
        notificationBody: ({ lastActivityRecord: { login } }) =>
          `Custom message for ${login}`,
        dryRun: false,
      });

      const user: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      await functionNotifier.notifyUser(user);

      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Custom message for test-user'),
        }),
      );
    });
  });

  describe('hasGracePeriodExpired', () => {
    it('returns true when notification is older than grace period', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

      const notification = {
        created_at: oldDate.toISOString(),
        labels: [],
        id: 1,
        number: 1,
        title: 'test-user',
        state: 'open',
      };

      expect(notifier.hasGracePeriodExpired(notification)).toBe(true);
    });

    it('returns false when notification is newer than grace period', () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3); // 3 days ago

      const notification = {
        created_at: recentDate.toISOString(),
        labels: [],
        id: 1,
        number: 1,
        title: 'test-user',
        state: 'open',
      };

      expect(notifier.hasGracePeriodExpired(notification)).toBe(false);
    });
  });

  describe('findReactivatedUsers', () => {
    it('identifies users who are no longer dormant', async () => {
      // Mock that we have open issues for users who are no longer in dormant list
      mockOctokit.rest.issues.listForRepo.mockResolvedValueOnce({
        data: [
          { title: 'active-user1', labels: [{ name: 'dormant-account' }] },
          { title: 'active-user2', labels: [{ name: 'dormant-account' }] },
          { title: 'dormant-user', labels: [{ name: 'dormant-account' }] },
        ],
      });

      const dormantUsers: LastActivityRecord[] = [
        {
          login: 'dormant-user',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
        {
          login: 'dormant-user2',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
      ];

      const reactivatedUsers =
        await notifier.findReactivatedUsers(dormantUsers);

      expect(reactivatedUsers).toContain('active-user1');
      expect(reactivatedUsers).toContain('active-user2');
      expect(reactivatedUsers).not.toContain('dormant-user');
    });
  });

  describe('processDormantUsers', () => {
    it('properly processes users in different states', async () => {
      // Mock existing notifications
      mockOctokit.rest.issues.listForRepo
        // First call for findReactivatedUsers
        .mockResolvedValueOnce({
          data: [
            {
              title: 'reactivated-user',
              labels: [{ name: 'dormant-account' }],
            },
          ],
        })
        // Second call for getExistingNotification - in grace period
        .mockResolvedValueOnce({
          data: [
            {
              title: 'grace-period-user',
              number: 2,
              id: 2,
              created_at: new Date().toISOString(), // recent, still in grace period
              state: 'open',
              labels: [
                { name: 'dormant-account' },
                { name: 'pending-removal' },
              ],
            },
          ],
        })
        // Third call for getExistingNotification - expired
        .mockResolvedValueOnce({
          data: [
            {
              title: 'expired-user',
              number: 3,
              id: 3,
              created_at: new Date(
                Date.now() - 10 * 24 * 60 * 60 * 1000,
              ).toISOString(), // 10 days old
              state: 'open',
              labels: [
                { name: 'dormant-account' },
                { name: 'pending-removal' },
              ],
            },
          ],
        })
        // Fourth call for getExistingNotification - excluded
        .mockResolvedValueOnce({
          data: [
            {
              title: 'excluded-user',
              number: 4,
              id: 4,
              created_at: new Date().toISOString(),
              state: 'open',
              labels: [
                { name: 'dormant-account' },
                { name: 'admin-exclusion' },
              ],
            },
          ],
        })
        // Fifth call for getExistingNotification - new user (empty response)
        .mockResolvedValueOnce({ data: [] })
        // Sixth call for reactivated-user's notification
        .mockResolvedValueOnce({
          data: [
            {
              title: 'reactivated-user',
              number: 5,
              id: 5,
              created_at: new Date().toISOString(),
              state: 'open',
              labels: [{ name: 'dormant-account' }],
            },
          ],
        });

      const dormantUsers: LastActivityRecord[] = [
        {
          login: 'grace-period-user',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
        {
          login: 'expired-user',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
        {
          login: 'excluded-user',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
        {
          login: 'new-user',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
      ];

      const result = await notifier.processDormantUsers(dormantUsers);

      // Verify results
      expect(result.inGracePeriod.length).toBe(1);
      // @ts-expect-error
      expect(result.inGracePeriod[0].user).toBe('grace-period-user');

      expect(result.removed.length).toBe(1);
      // @ts-expect-error
      expect(result.removed[0].user).toBe('expired-user');

      expect(result.excluded.length).toBe(1);
      // @ts-expect-error
      expect(result.excluded[0].user).toBe('excluded-user');

      expect(result.notified.length).toBe(1);
      // @ts-expect-error
      expect(result.notified[0].user).toBe('new-user');

      expect(result.reactivated.length).toBe(1);
      // @ts-expect-error
      expect(result.reactivated[0].user).toBe('reactivated-user');
    });

    it('respects dryRun flag', async () => {
      // Create a notifier with dryRun enabled
      const dryRunNotifier = new GithubIssueNotifier({
        githubClient: mockOctokit,
        gracePeriod: '7d',
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
          baseLabels: ['dormant-account'],
        },
        notificationBody: 'Test notification body',
        dryRun: true,
      });

      // Reset mock call counts
      mockOctokit.rest.issues.create.mockClear();
      mockOctokit.rest.issues.update.mockClear();

      // Mock for no existing notifications to keep test simple
      mockOctokit.rest.issues.listForRepo.mockResolvedValue({ data: [] });

      const dormantUsers: LastActivityRecord[] = [
        {
          login: 'test-user',
          lastActivity: new Date('2023-01-01'),
          type: 'user',
        },
      ];

      await dryRunNotifier.processDormantUsers(dormantUsers);

      // In dry run mode, should not call create or update
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
    });
  });

  describe('removeAccount', () => {
    it('handles user removal with a custom handler', async () => {
      const mockRemoveHandler = vi.fn().mockResolvedValue(true);

      const handlerNotifier = new GithubIssueNotifier({
        githubClient: mockOctokit,
        gracePeriod: '7d',
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
          baseLabels: ['dormant-account'],
        },
        notificationBody: 'Test notification body',
        dryRun: false,
        removeAccount: mockRemoveHandler,
      });

      const user: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      const notification = {
        id: 123,
        number: 1,
        title: 'test-user',
        created_at: new Date().toISOString(),
        labels: [],
        state: 'open',
      };

      // @ts-expect-error
      await handlerNotifier.removeAccount(user, notification);

      // Verify handler was called with correct parameters
      expect(mockRemoveHandler).toHaveBeenCalledWith({
        lastActivityRecord: user,
      });

      // Verify issue was updated correctly
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 1,
          body: expect.stringContaining('removed due to inactivity'),
        }),
      );

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 1,
          labels: [NotificationStatus.REMOVED],
        }),
      );

      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 1,
          state: 'closed',
        }),
      );
    });

    it('works without a custom handler', async () => {
      const user: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      const notification = {
        id: 123,
        number: 1,
        title: 'test-user',
        created_at: new Date().toISOString(),
        labels: [],
        state: 'open',
      };

      // @ts-expect-error
      await notifier.removeAccount(user, notification);

      // Just verify the issue was updated correctly
      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 1,
          state: 'closed',
        }),
      );
    });
  });

  describe('closeNotificationForActiveUser', () => {
    it('closes notification and updates labels for active user', async () => {
      const user: LastActivityRecord = {
        login: 'active-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      const notification = {
        id: 456,
        number: 42,
        title: 'active-user',
        created_at: new Date().toISOString(),
        labels: [{ name: NotificationStatus.PENDING }],
        state: 'open',
      };

      await notifier.closeNotificationForActiveUser(
        user,
        notification as NotificationIssue,
      );

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        body: 'User active-user is now active. No removal needed.',
      });

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        labels: [NotificationStatus.ACTIVE],
      });

      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        name: NotificationStatus.PENDING,
      });

      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        state: 'closed',
        state_reason: 'not_planned',
      });
    });

    it('handles missing pending label gracefully', async () => {
      mockOctokit.rest.issues.removeLabel.mockRejectedValueOnce({
        status: 404,
      });

      const user: LastActivityRecord = {
        login: 'active-user',
        lastActivity: new Date('2023-01-01'),
        type: 'user',
      };

      const notification = {
        id: 789,
        number: 43,
        title: 'active-user',
        created_at: new Date().toISOString(),
        labels: [{ name: NotificationStatus.ACTIVE }],
        state: 'open',
      };

      await notifier.closeNotificationForActiveUser(
        user,
        notification as NotificationIssue,
      );

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 43,
        body: 'User active-user is now active. No removal needed.',
      });

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 43,
        labels: [NotificationStatus.ACTIVE],
      });

      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 43,
        name: NotificationStatus.PENDING,
      });

      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 43,
        state: 'closed',
        state_reason: 'not_planned',
      });
    });
  });
});
