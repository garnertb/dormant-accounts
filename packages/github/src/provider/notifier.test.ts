import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GithubIssueNotifier, NotificationStatus } from './notifier';
import { LastActivityRecord } from 'dormant-accounts';

describe('GithubIssueNotifier', () => {
  let mockOctokit: any;
  let notifier: GithubIssueNotifier;

  const createMockOctokit = () => ({
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

    notifier = new GithubIssueNotifier({
      githubClient: mockOctokit,
      gracePeriod: '7d',
      repository: {
        owner: 'test-owner',
        repo: 'test-repo',
        baseLabels: ['dormant-account'],
      },
      notificationBody: 'Test notification body',
      dryRun: false,
    });
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
        assignees: ['garnertb'],
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
        notificationBody: (user) => `Custom message for ${user.login}`,
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
          lastActivity: new Date('2023-01-01').toISOString(),
        },
        {
          login: 'dormant-user2',
          lastActivity: new Date('2023-01-01').toISOString(),
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
          lastActivity: new Date('2023-01-01').toISOString(),
        },
        {
          login: 'expired-user',
          lastActivity: new Date('2023-01-01').toISOString(),
        },
        {
          login: 'excluded-user',
          lastActivity: new Date('2023-01-01').toISOString(),
        },
        {
          login: 'new-user',
          lastActivity: new Date('2023-01-01').toISOString(),
        },
      ];

      const result = await notifier.processDormantUsers(dormantUsers);

      // Verify results
      expect(result.inGracePeriod.length).toBe(1);
      expect(result.inGracePeriod[0].user).toBe('grace-period-user');

      expect(result.removed.length).toBe(1);
      expect(result.removed[0].user).toBe('expired-user');

      expect(result.excluded.length).toBe(1);
      expect(result.excluded[0].user).toBe('excluded-user');

      expect(result.notified.length).toBe(1);
      expect(result.notified[0].user).toBe('new-user');

      expect(result.reactivated.length).toBe(1);
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
          lastActivity: new Date('2023-01-01').toISOString(),
        },
      ];

      await dryRunNotifier.processDormantUsers(dormantUsers);

      // In dry run mode, should not call create or update
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
    });
  });
});
