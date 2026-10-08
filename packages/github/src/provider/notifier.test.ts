import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GithubIssueNotifier,
  NotificationConfig,
  NotificationStatus,
  normalizeRemoveAccountOutcome,
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
    const DAY = 24 * 60 * 60 * 1000;

    const openIssue = (
      number: number,
      title: string,
      {
        ageDays = 1,
        labels = ['dormant-account', NotificationStatus.PENDING],
        pullRequest = false,
      }: { ageDays?: number; labels?: string[]; pullRequest?: boolean } = {},
    ) => ({
      id: number,
      number,
      title,
      state: 'open',
      html_url: `https://github.com/test-owner/test-repo/issues/${number}`,
      created_at: new Date(Date.now() - ageDays * DAY).toISOString(),
      labels: labels.map((name) => ({ name })),
      ...(pullRequest ? { pull_request: { url: 'pr' } } : {}),
    });

    const dormant = (login: string): LastActivityRecord => ({
      login,
      lastActivity: new Date('2023-01-01'),
      type: 'user',
    });

    const mockOpenIssues = (issues: unknown[]) =>
      mockOctokit.rest.issues.listForRepo.mockResolvedValue({ data: issues });

    const users = (entries: Array<{ user: string }>) =>
      entries.map(({ user }) => user);

    it('properly processes users in different states', async () => {
      mockOpenIssues([
        openIssue(2, 'grace-period-user'),
        openIssue(3, 'expired-user', { ageDays: 10 }),
        openIssue(4, 'excluded-user', {
          labels: ['dormant-account', NotificationStatus.EXCLUDED],
        }),
        openIssue(5, 'reactivated-user'),
      ]);

      const result = await notifier.processDormantUsers([
        dormant('grace-period-user'),
        dormant('expired-user'),
        dormant('excluded-user'),
        dormant('new-user'),
      ]);

      expect(users(result.inGracePeriod)).toEqual(['grace-period-user']);
      expect(users(result.removed)).toEqual(['expired-user']);
      expect(users(result.excluded)).toEqual(['excluded-user']);
      expect(users(result.notified)).toEqual(['new-user']);
      expect(users(result.reactivated)).toEqual(['reactivated-user']);
      expect(result.departed).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.wouldRemove).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('lists open notifications once using the base labels', async () => {
      mockOpenIssues([]);

      await notifier.processDormantUsers([dormant('a'), dormant('b')]);

      expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          state: 'open',
          labels: 'dormant-account',
        }),
      );
    });

    it('finds the exact title among more than 50 open notifications', async () => {
      const issues = Array.from({ length: 120 }, (_, i) =>
        openIssue(i + 1, `user${i + 1}`),
      );
      mockOpenIssues(issues);

      const result = await notifier.processDormantUsers([dormant('user1')]);

      expect(result.inGracePeriod).toHaveLength(1);
      expect(result.inGracePeriod[0]?.notification.number).toBe(1);
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
      expect(result.reactivated).toHaveLength(119);
    });

    it('matches notification titles case-insensitively', async () => {
      mockOpenIssues([openIssue(7, 'Mixed-Case')]);

      const result = await notifier.processDormantUsers([
        dormant('mixed-case'),
      ]);

      expect(result.inGracePeriod).toEqual([
        {
          user: 'mixed-case',
          notification: expect.objectContaining({ number: 7 }),
        },
      ]);
      expect(result.reactivated).toEqual([]);
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
    });

    it('uses the oldest notification when titles are duplicated', async () => {
      mockOpenIssues([
        openIssue(9, 'dup-user', { ageDays: 1 }),
        openIssue(8, 'dup-user', { ageDays: 3 }),
      ]);

      const result = await notifier.processDormantUsers([dormant('dup-user')]);

      expect(result.inGracePeriod[0]?.notification.number).toBe(8);
    });

    it('ignores pull requests carrying the base label', async () => {
      mockOpenIssues([openIssue(11, 'pr-user', { pullRequest: true })]);

      const result = await notifier.processDormantUsers([dormant('pr-user')]);

      expect(users(result.notified)).toEqual(['pr-user']);
      expect(result.reactivated).toEqual([]);
    });

    it('closes notifications for users no longer in scope as departed', async () => {
      mockOpenIssues([
        openIssue(20, 'gone-user'),
        openIssue(21, 'active-user'),
      ]);

      const result = await notifier.processDormantUsers([], {
        inScopeLogins: ['Active-User', 'someone-else'],
      });

      expect(users(result.departed)).toEqual(['gone-user']);
      expect(users(result.reactivated)).toEqual(['active-user']);

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 20,
          labels: [NotificationStatus.DEPARTED],
        }),
      );
      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 21,
          labels: [NotificationStatus.ACTIVE],
        }),
      );
      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 20,
          state: 'closed',
          state_reason: 'not_planned',
        }),
      );
    });

    it('treats every non-dormant notification as reactivated without a scope', async () => {
      mockOpenIssues([openIssue(30, 'gone-user')]);

      const result = await notifier.processDormantUsers([]);

      expect(users(result.reactivated)).toEqual(['gone-user']);
      expect(result.departed).toEqual([]);
    });

    it('respects dryRun flag', async () => {
      const removeAccount = vi.fn().mockResolvedValue('removed');
      const dryRunNotifier = createNotifier({ dryRun: true, removeAccount });

      mockOpenIssues([
        openIssue(40, 'expired-user', { ageDays: 10 }),
        openIssue(41, 'gone-user'),
        openIssue(42, 'active-user'),
      ]);

      const result = await dryRunNotifier.processDormantUsers(
        [dormant('expired-user'), dormant('new-user')],
        { inScopeLogins: ['expired-user', 'new-user', 'active-user'] },
      );

      expect(users(result.notified)).toEqual(['new-user']);
      expect(users(result.wouldRemove)).toEqual(['expired-user']);
      expect(users(result.departed)).toEqual(['gone-user']);
      expect(users(result.reactivated)).toEqual(['active-user']);
      expect(result.removed).toEqual([]);

      expect(removeAccount).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.addLabels).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    });

    describe('expired notifications', () => {
      const expired = openIssue(50, 'expired-user', { ageDays: 10 });

      beforeEach(() => {
        mockOpenIssues([expired]);
      });

      it.each([true, 'removed'] as const)(
        'records %s from the handler as removed',
        async (handlerResult) => {
          const removeAccount = vi.fn().mockResolvedValue(handlerResult);
          const result = await createNotifier({
            removeAccount,
          }).processDormantUsers([dormant('expired-user')]);

          expect(users(result.removed)).toEqual(['expired-user']);
          expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
            expect.objectContaining({
              issue_number: 50,
              labels: [NotificationStatus.REMOVED],
            }),
          );
          expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
            expect.objectContaining({ issue_number: 50, state: 'closed' }),
          );
        },
      );

      it('passes the notification issue to the handler', async () => {
        const removeAccount = vi.fn().mockResolvedValue('removed');
        const user = dormant('expired-user');

        await createNotifier({ removeAccount }).processDormantUsers([user]);

        expect(removeAccount).toHaveBeenCalledWith({
          lastActivityRecord: user,
          notification: expect.objectContaining({ number: 50 }),
        });
      });

      it('closes already-absent accounts as departed', async () => {
        const removeAccount = vi.fn().mockResolvedValue('already-absent');

        const result = await createNotifier({
          removeAccount,
        }).processDormantUsers([dormant('expired-user')]);

        expect(users(result.departed)).toEqual(['expired-user']);
        expect(result.removed).toEqual([]);
        expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
          expect.objectContaining({
            issue_number: 50,
            labels: [NotificationStatus.DEPARTED],
          }),
        );
        expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
          expect.objectContaining({
            issue_number: 50,
            state: 'closed',
            state_reason: 'not_planned',
          }),
        );
      });

      it.each([false, 'skipped'] as const)(
        'leaves the notification open when the handler returns %s',
        async (handlerResult) => {
          const removeAccount = vi.fn().mockResolvedValue(handlerResult);

          const result = await createNotifier({
            removeAccount,
          }).processDormantUsers([dormant('expired-user')]);

          expect(users(result.skipped)).toEqual(['expired-user']);
          expect(result.removed).toEqual([]);
          expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
          expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
          expect(mockOctokit.rest.issues.addLabels).not.toHaveBeenCalled();
        },
      );

      it('records handler errors and leaves the notification open', async () => {
        const removeAccount = vi.fn().mockRejectedValue(new Error('boom'));

        const result = await createNotifier({
          removeAccount,
        }).processDormantUsers([dormant('expired-user')]);

        expect(result.errors).toEqual([
          { user: 'expired-user', error: new Error('boom') },
        ]);
        expect(result.removed).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('removeAccount', () => {
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
    } as unknown as NotificationIssue;

    it('handles user removal with a custom handler', async () => {
      const mockRemoveHandler = vi.fn().mockResolvedValue(true);
      const handlerNotifier = createNotifier({
        removeAccount: mockRemoveHandler,
      });

      const outcome = await handlerNotifier.removeAccount(user, notification);

      expect(outcome).toBe('removed');
      expect(mockRemoveHandler).toHaveBeenCalledWith({
        lastActivityRecord: user,
        notification,
      });

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
      const outcome = await notifier.removeAccount(user, notification);

      expect(outcome).toBe('removed');
      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 1,
          state: 'closed',
        }),
      );
    });
  });

  describe('normalizeRemoveAccountOutcome', () => {
    it.each([
      [true, 'removed'],
      ['removed', 'removed'],
      ['already-absent', 'already-absent'],
      [false, 'skipped'],
      ['skipped', 'skipped'],
      [undefined, 'skipped'],
    ] as const)('maps %s to %s', (input, expected) => {
      expect(normalizeRemoveAccountOutcome(input)).toBe(expected);
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
