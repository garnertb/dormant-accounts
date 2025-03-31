import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getNotificationContext } from './utils/getNotificationContext';
import { getContext } from './utils/getContext';
import { getActivityLog } from './utils/getActivityLog';

// Mock dependencies
vi.mock('@actions/core');
vi.mock('@actions/github');
vi.mock('./utils/updateActivityLog', () => ({
  updateActivityLog: vi.fn().mockResolvedValue({}),
}));
vi.mock('./utils/checkBranch', () => ({
  checkBranch: vi.fn().mockResolvedValue(true),
}));
vi.mock('./utils/createBranch', () => ({
  createBranch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./utils/getActivityLog', () => ({
  getActivityLog: vi.fn().mockResolvedValue({
    sha: 'mock-sha',
    content: '{}',
  }),
}));
vi.mock('./utils/getNotificationContext');
vi.mock('./utils/getContext');
vi.mock('@dormant-accounts/github', () => {
  return {
    copilotDormancy: vi.fn(),
    githubDormancy: vi.fn(),
    GithubIssueNotifier: vi.fn().mockImplementation(() => ({
      processDormantUsers: vi.fn().mockResolvedValue({
        notified: [],
        reactivated: [],
        removed: [],
        excluded: [],
        inGracePeriod: [],
        errors: [],
      }),
    })),
    createDefaultNotificationBodyHandler: vi.fn(),
  };
});

// Mock process.env
const originalEnv = process.env;

describe('Copilot Dormancy Action', () => {
  // Create a mock check object to reuse
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

  beforeEach(() => {
    // Reset modules and mocks
    vi.resetModules();
    vi.resetAllMocks();

    // Setup GitHub mocks
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: {
        repos: {
          createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
        },
      },
    } as any);

    // Setup core.summary mock methods
    vi.mocked(core.summary).addHeading = vi.fn().mockReturnValue(core.summary);
    vi.mocked(core.summary).addRaw = vi.fn().mockReturnValue(core.summary);
    vi.mocked(core.summary).addBreak = vi.fn().mockReturnValue(core.summary);
    vi.mocked(core.summary).addTable = vi.fn().mockReturnValue(core.summary);
    vi.mocked(core.summary).addList = vi.fn().mockReturnValue(core.summary);
    vi.mocked(core.summary).addEOL = vi.fn().mockReturnValue(core.summary);
    vi.mocked(core.summary).write = vi.fn().mockResolvedValue(core.summary);

    // Setup mock for isDebug
    vi.mocked(core.isDebug).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should run the dormancy check and set outputs', async () => {
    // Setup notification context mock
    vi.mocked(getNotificationContext).mockReturnValue(false);
    const mockedCheck = createMockCheckObject();
    const mocktokit = vi.fn();

    // Setup input mocks
    vi.mocked(getContext).mockReturnValue({
      dryRun: false,
      org: 'test-owner',
      duration: '90d',
      // @ts-expect-error
      check: mockedCheck,
      // @ts-expect-error
      octokit: mocktokit,
      activityLog: {
        branchName: 'copilot-dormancy',
        path: 'copilot-dormancy.json',
        repo: {
          repo: 'test-repo',
          owner: 'test-owner',
        },
      },
    });

    // Import and execute the run function directly
    const { run } = await import('./run');
    await run();
    expect(core.setFailed).toHaveBeenCalledTimes(0);

    const { updateActivityLog } = await import('./utils/updateActivityLog');

    // Verify updateActivityLog was called
    expect(updateActivityLog).toHaveBeenCalledWith(
      mocktokit,
      { owner: 'test-owner', repo: 'test-repo' },
      expect.objectContaining({
        branch: 'copilot-dormancy',
        path: 'copilot-dormancy.json',
        content: expect.any(String),
        message: expect.stringContaining('Update Copilot dormancy log for'),
      }),
    );

    // Verify outputs were set
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

    // Verify core.summary methods were called
    expect(core.summary.addHeading).toHaveBeenCalled();
    expect(core.summary.addRaw).toHaveBeenCalled();
    expect(core.summary.write).toHaveBeenCalled();
  });

  it('should handle dry run mode correctly', async () => {
    // For dry run test, disable notifications
    vi.mocked(getNotificationContext).mockReturnValue(false);

    const mockedCheck = createMockCheckObject();

    // Setup input mocks
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'test-owner/test-repo',
        duration: '90d',
        'check-type': 'copilot-dormancy',
        token: 'mock-token',
        'dry-run': 'true',
        'notifications-enabled': '', // Disable notifications
      };
      return inputs[name] || '';
    });

    // Setup input mocks
    vi.mocked(getContext).mockReturnValue({
      dryRun: true,
      org: 'test-owner',
      duration: '90d',
      // @ts-expect-error
      check: mockedCheck,
      // @ts-expect-error
      octokit: vi.fn(),
      activityLog: {
        branchName: 'copilot-dormancy',
        path: 'copilot-dormancy.json',
        repo: {
          repo: 'test-repo',
          owner: 'test-owner',
        },
      },
    });

    // Import and execute the run function directly
    const { run } = await import('./run');
    await run();

    const { checkBranch } = await import('./utils/checkBranch');
    const { updateActivityLog } = await import('./utils/updateActivityLog');

    vi.mocked(updateActivityLog).mockImplementation(vi.fn());
    vi.mocked(checkBranch).mockImplementation(vi.fn());

    // In dry run mode, we shouldn't call updateActivityLog
    expect(updateActivityLog).not.toHaveBeenCalled();
    expect(checkBranch).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    // For error test, disable notifications
    vi.mocked(getNotificationContext).mockReturnValue(false);

    // Setup input mocks
    vi.mocked(getContext).mockReturnValue({
      dryRun: true,
      org: 'test-owner',
      duration: '90d',
      // @ts-expect-error
      check: createMockCheckObject(),
      // @ts-expect-error
      octokit: vi.fn(),
      activityLog: {
        branchName: 'copilot-dormancy',
        path: 'copilot-dormancy.json',
        repo: {
          repo: 'test-repo',
          owner: 'test-owner',
        },
      },
    });

    // Mock copilotDormancy to throw an error

    vi.mocked(getActivityLog).mockRejectedValueOnce(new Error('Test error'));

    // Import the run function
    const { run } = await import('./run');

    // Run and expect it to throw
    await expect(run()).rejects.toThrow('Test error');

    // Verify error handling occurred
    expect(core.setFailed).toHaveBeenCalledWith(
      'Action failed with error: Test error',
    );
    expect(core.setOutput).toHaveBeenCalledWith('error', 'Test error');
  });
});
