import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import * as github from '@actions/github';

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
vi.mock('@dormant-accounts/github', () => {
  return {
    copilotDormancy: vi.fn(),
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
    getDatabaseData: vi.fn().mockResolvedValue({
      _state: { lastRun: '2023-01-01T00:00:00.000Z' },
      users: { 'active-user': {}, 'dormant-user': {} },
    }),
  });

  beforeEach(() => {
    // Reset modules and mocks
    vi.resetModules();
    vi.resetAllMocks();

    // Make sure CI is false to prevent auto-execution of run()
    process.env = { ...originalEnv, CI: 'false' };

    // Setup GitHub mocks
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: {
        repos: {
          createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
        },
      },
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = originalEnv;
  });

  it('should run the dormancy check and set outputs', async () => {
    // Setup a fresh mock for the check object
    const { copilotDormancy } = await import('@dormant-accounts/github');
    vi.mocked(copilotDormancy).mockResolvedValue(createMockCheckObject());

    // Setup input mocks
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'test-owner/test-repo',
        duration: '90d',
        token: 'mock-token',
        'dry-run': 'false',
      };
      return inputs[name] || '';
    });

    // Import and execute the run function directly
    const { run } = await import('./index');
    await run();

    const { updateActivityLog } = await import('./utils/updateActivityLog');

    // Verify the function was called with correct parameters
    expect(copilotDormancy).toHaveBeenCalledWith({
      type: 'copilot-dormancy',
      duration: '90d',
      dryRun: false,
      conf: {
        octokit: expect.anything(),
        org: 'test-org',
      },
    });

    // Verify updateActivityLog was called
    expect(updateActivityLog).toHaveBeenCalledWith(
      expect.anything(),
      { owner: 'test-owner', repo: 'test-repo' },
      expect.objectContaining({
        branch: 'copilot-dormancy',
        path: 'copilot-dormancy.json',
        content: expect.any(String),
        message: expect.stringMatching(/Update Copilot dormancy log for/),
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
  });

  it('should handle dry run mode correctly', async () => {
    // Setup a fresh mock for the check object
    const { copilotDormancy } = await import('@dormant-accounts/github');
    vi.mocked(copilotDormancy).mockResolvedValue(createMockCheckObject());

    // Setup input mocks
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'test-owner/test-repo',
        duration: '90d',
        token: 'mock-token',
        'dry-run': 'true',
      };
      return inputs[name] || '';
    });

    // Import and execute the run function directly
    const { run } = await import('./index');
    await run();

    const { updateActivityLog } = await import('./utils/updateActivityLog');

    // Verify dry run was passed correctly
    expect(copilotDormancy).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
      }),
    );

    // In dry run mode, we shouldn't call updateActivityLog
    expect(updateActivityLog).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    // Setup input mocks for this test
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'test-owner/test-repo',
        duration: '90d',
        token: 'mock-token',
        'dry-run': 'false',
      };
      return inputs[name] || '';
    });

    // Mock copilotDormancy to throw an error
    const { copilotDormancy } = await import('@dormant-accounts/github');
    vi.mocked(copilotDormancy).mockRejectedValueOnce(new Error('Test error'));

    // Import the run function
    const { run } = await import('./index');

    // Run and expect it to throw
    await expect(run()).rejects.toThrow('Test error');

    // Verify error handling occurred
    expect(core.setFailed).toHaveBeenCalledWith(
      'Action failed with error: Test error',
    );
    expect(core.setOutput).toHaveBeenCalledWith('error', 'Test error');
  });
});
