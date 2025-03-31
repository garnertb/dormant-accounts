import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getContext } from './getContext';
import * as githubDormancy from '@dormant-accounts/github';

// Mock dependencies
vi.mock('@actions/core');
vi.mock('@actions/github', () => {
  return {
    getOctokit: vi.fn(),
  };
});

vi.mock('@dormant-accounts/github', () => {
  return {
    copilotDormancy: vi.fn(),
    githubDormancy: vi.fn(),
  };
});

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

describe('GetContext', () => {
  beforeEach(() => {
    // Reset modules and mocks
    vi.resetModules();
    vi.resetAllMocks();

    // Setup mock for isDebug
    vi.mocked(core.isDebug).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails if no inputs provided', async () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {};
      return inputs[name] || '';
    });

    // Import and execute the run function directly
    const context = getContext();
    expect(context).toEqual(false);
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid action inputs'),
    );
  });

  it('returns context with valid inputs', async () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      const inputs: Record<string, string> = {
        org: 'test-org',
        'activity-log-repo': 'test-owner/test-repo',
        duration: '90d',
        dryRun: 'false',
        token: 'mock-token',
        'check-type': 'copilot-dormancy',
      };
      return inputs[name] || '';
    });

    const context = getContext();

    expect(githubDormancy.copilotDormancy).toHaveBeenCalledOnce();
    expect(githubDormancy.githubDormancy).not.toHaveBeenCalled();
    expect(github.getOctokit).toHaveBeenCalledWith('mock-token');

    expect(context).toEqual(
      expect.objectContaining({
        org: 'test-org',
        activityLog: {
          branchName: 'copilot-dormancy',
          path: 'copilot-dormancy.json',
          repo: {
            owner: 'test-owner',
            repo: 'test-repo',
          },
        },
        duration: '90d',
        dryRun: false,
      }),
    );
  });
});
