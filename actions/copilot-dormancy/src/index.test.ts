import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import {
  getNotificationContext,
  saveActivityLog,
} from '@dormant-accounts/action-utils';
import { GithubIssueNotifier } from '@dormant-accounts/github';
import { copilotDormancy } from '@dormant-accounts/github/copilot';
import { run } from './run';

vi.mock('@actions/core');
vi.mock('@dormant-accounts/action-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@dormant-accounts/action-utils')>();
  return {
    ...actual,
    createThrottledOctokit: vi.fn(() => ({})),
    loadActivityLog: vi.fn(async () => 'mock-sha'),
    saveActivityLog: vi.fn(async () => ({})),
    getNotificationContext: vi.fn(actual.getNotificationContext),
  };
});
vi.mock('@dormant-accounts/github/copilot', () => ({
  copilotDormancy: vi.fn(),
}));
vi.mock('@dormant-accounts/github', () => ({
  GithubIssueNotifier: vi.fn(function () {
    return {
      processDormantUsers: vi.fn(async () => ({
        notified: [],
        reactivated: [],
        removed: [],
        excluded: [],
        inGracePeriod: [],
        departed: [],
        skipped: [],
        wouldRemove: [],
        errors: [],
      })),
    };
  }),
}));

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
  },
});

const setInputs = (inputs: Record<string, string>) => {
  vi.mocked(core.getInput).mockImplementation((name) => inputs[name] || '');
  vi.mocked(core.getBooleanInput).mockImplementation(
    (name) => inputs[name] === 'true',
  );
};

const baseInputs = {
  org: 'test-org',
  'activity-log-repo': 'test-owner/test-repo',
  duration: '90d',
  token: 'mock-token',
  'dry-run': 'false',
  'authenticated-at-behavior': 'ignore',
};

const notificationInputs = {
  'notifications-enabled': 'true',
  'notifications-repo': 'test-owner/test-repo',
  'notifications-duration': '30d',
  'notifications-body': 'Test notification body',
  'notifications-dry-run': 'false',
  'assign-user-to-notification-issue': 'true',
  'remove-dormant-accounts': 'true',
  'remove-user-from-assigning-team': 'false',
};

describe('Copilot Dormancy Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    for (const method of [
      'addHeading',
      'addRaw',
      'addBreak',
      'addTable',
      'addList',
      'addEOL',
    ] as const) {
      vi.mocked(core.summary)[method] = vi
        .fn()
        .mockReturnValue(core.summary) as never;
    }
    vi.mocked(core.summary).write = vi.fn().mockResolvedValue(core.summary);
    vi.mocked(core.isDebug).mockReturnValue(false);
    // @ts-expect-error partial check object
    vi.mocked(copilotDormancy).mockResolvedValue(createMockCheckObject());
  });

  it('should run the dormancy check and set outputs', async () => {
    setInputs({ ...baseInputs, ...notificationInputs });

    await run();

    expect(copilotDormancy).toHaveBeenCalledWith({
      type: 'copilot-dormancy',
      duration: '90d',
      dryRun: false,
      conf: {
        octokit: expect.anything(),
        org: 'test-org',
        authenticatedAtBehavior: 'ignore',
      },
    });

    expect(getNotificationContext).toHaveBeenCalledWith({
      baseLabel: 'copilot-dormancy',
      dryRun: false,
    });
    expect(GithubIssueNotifier).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        repository: {
          owner: 'test-owner',
          repo: 'test-repo',
          baseLabels: ['copilot-dormancy'],
        },
      }),
    );

    expect(saveActivityLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repo: { owner: 'test-owner', repo: 'test-repo' },
        branch: 'copilot-dormancy',
        path: 'copilot-dormancy.json',
        sha: 'mock-sha',
        content: expect.objectContaining({ _state: expect.anything() }),
        message: expect.stringMatching(/Update Copilot dormancy log for/),
      }),
    );

    expect(core.setOutput).toHaveBeenCalledWith(
      'dormant-users',
      expect.any(String),
    );
    expect(core.setOutput).toHaveBeenCalledWith(
      'active-users',
      expect.any(String),
    );
    expect(core.setOutput).toHaveBeenCalledWith(
      'last-activity-fetch',
      expect.any(String),
    );
    expect(core.setOutput).toHaveBeenCalledWith(
      'check-stats',
      expect.any(String),
    );
    expect(core.setOutput).toHaveBeenCalledWith(
      'notification-results',
      expect.any(String),
    );

    expect(core.summary.addHeading).toHaveBeenCalled();
    expect(core.summary.addRaw).toHaveBeenCalled();
    expect(core.summary.write).toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('should handle dry run mode correctly', async () => {
    setInputs({ ...baseInputs, 'dry-run': 'true' });

    await run();

    expect(copilotDormancy).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
      }),
    );
    expect(GithubIssueNotifier).not.toHaveBeenCalled();
    expect(saveActivityLog).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['false', 'false'],
    ['false', 'true'],
    ['true', 'false'],
    ['true', 'true'],
  ])(
    'global dry run forces notification dry run (notifications-dry-run=%s, remove-dormant-accounts=%s)',
    async (notificationsDryRun, removeDormantAccounts) => {
      setInputs({
        ...baseInputs,
        ...notificationInputs,
        'dry-run': 'true',
        'notifications-dry-run': notificationsDryRun,
        'remove-dormant-accounts': removeDormantAccounts,
      });

      await run();

      expect(getNotificationContext).toHaveBeenCalledWith({
        baseLabel: 'copilot-dormancy',
        dryRun: true,
      });
      expect(GithubIssueNotifier).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
      );
      expect(saveActivityLog).not.toHaveBeenCalled();
    },
  );

  it('should handle errors gracefully', async () => {
    setInputs(baseInputs);
    vi.mocked(copilotDormancy).mockRejectedValueOnce(new Error('Test error'));

    await expect(run()).rejects.toThrow('Test error');

    expect(core.setFailed).toHaveBeenCalledWith(
      'Action failed with error: Test error',
    );
    expect(core.setOutput).toHaveBeenCalledWith('error', 'Test error');
  });
});
