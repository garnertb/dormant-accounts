import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import * as github from '@actions/github';

// Mock dependencies
vi.mock('@actions/core');
vi.mock('@actions/github');
vi.mock('@dormant-accounts/github', () => {
  const mockCheck = {
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
  };

  return {
    copilotDormancy: vi.fn().mockResolvedValue(mockCheck),
  };
});

describe('Copilot Dormancy Action', () => {
  const mockOctokit = {
    rest: {
      repos: {
        createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
      },
    },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();

    // Setup input mocks
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'activity-logs',
        duration: '90d',
        token: 'mock-token',
        'dry-run': 'false',
      };
      return inputs[name] || '';
    });

    // Setup GitHub mocks
    vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should run the dormancy check and set outputs', async () => {
    // Import the module to trigger the run function
    await import('./index');

    const { copilotDormancy } = await import('@dormant-accounts/github');

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

    // Verify activity was fetched
    const mockCheck = await vi.mocked(copilotDormancy).mock.results[0]?.value;
    expect(mockCheck.fetchActivity).toHaveBeenCalled();
    expect(mockCheck.listDormantAccounts).toHaveBeenCalled();
    expect(mockCheck.listActiveAccounts).toHaveBeenCalled();

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
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'activity-logs',
        duration: '90d',
        token: 'mock-token',
        'dry-run': 'true',
      };
      return inputs[name] || '';
    });

    // Reset module cache to re-run with new mocks
    vi.resetModules();

    // Import the module to trigger the run function
    await import('./index');

    // Verify dry run was passed correctly
    const { copilotDormancy } = await import('@dormant-accounts/github');
    expect(copilotDormancy).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
      }),
    );

    // In dry run mode, we shouldn't create/update the file
    expect(
      mockOctokit.rest.repos.createOrUpdateFileContents,
    ).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    // Setup copilotDormancy to throw an error
    const { copilotDormancy } = await import('@dormant-accounts/github');
    vi.mocked(copilotDormancy).mockRejectedValueOnce(new Error('Test error'));

    // Reset module cache to re-run with new mocks
    vi.resetModules();

    // Import the module to trigger the run function
    await import('./index');

    // Verify error handling
    expect(core.setFailed).toHaveBeenCalledWith(
      'Action failed with error: Test error',
    );
    expect(core.setOutput).toHaveBeenCalledWith('error', 'Test error');
  });
});
