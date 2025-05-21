import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module being tested
vi.mock('@actions/core', () => ({
  info: vi.fn(),
}));

vi.mock('@dormant-accounts/github', () => ({
  revokeCopilotLicense: vi.fn(),
  removeCopilotUserFromTeam: vi.fn(),
}));

// Import after mocking
import { removeCopilotLicense } from './removeCopilotLicense';
import * as core from '@actions/core';
import {
  revokeCopilotLicense,
  removeCopilotUserFromTeam,
} from '@dormant-accounts/github';

describe('removeCopilotAccount', () => {
  const mockOctokit = {
    rest: {
      copilot: {
        getCopilotSeatDetailsForUser: vi.fn(),
      },
    },
  };

  const mockActivityRemove = vi.fn();
  const mockActivity = {
    remove: mockActivityRemove,
  };

  const defaultParams = {
    lastActivityRecord: {
      login: 'testuser',
      lastActivity: new Date(),
      type: 'copilot',
    } as any,
    octokit: mockOctokit as any,
    owner: 'test-org',
    removeDormantAccounts: true,
    allowTeamRemoval: false,
    activity: mockActivity as any,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: {
        pending_cancellation_date: null,
        assigning_team: null,
      },
    });
    vi.mocked(revokeCopilotLicense).mockResolvedValue(true);
    vi.mocked(removeCopilotUserFromTeam).mockResolvedValue(true);
  });

  it('should return true if user has a pending cancellation date', async () => {
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: {
        pending_cancellation_date: '2025-06-01',
        assigning_team: null,
      },
    });

    const result = await removeCopilotLicense({
      ...defaultParams,
    });

    expect(result).toBe(true);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('pending cancellation date'),
    );
    expect(revokeCopilotLicense).not.toHaveBeenCalled();
    expect(removeCopilotUserFromTeam).not.toHaveBeenCalled();
  });

  it('should return false when removeDormantAccounts is false and no pending cancellation', async () => {
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: {
        pending_cancellation_date: null,
        assigning_team: null,
      },
    });

    const result = await removeCopilotLicense({
      ...defaultParams,
      removeDormantAccounts: false,
    });

    expect(result).toBe(false);
    expect(revokeCopilotLicense).not.toHaveBeenCalled();
    expect(removeCopilotUserFromTeam).not.toHaveBeenCalled();
  });

  it('should not remove user from team by default when allowTeamRemoval is false', async () => {
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: {
        pending_cancellation_date: null,
        assigning_team: { name: 'copilot-team' },
      },
    });

    // Using default params which has allowTeamRemoval: false
    const result = await removeCopilotLicense(defaultParams);

    expect(result).toBe(false);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('team removal is disabled for safety'),
    );
    expect(removeCopilotUserFromTeam).not.toHaveBeenCalled();
    expect(revokeCopilotLicense).not.toHaveBeenCalled();
    expect(mockActivityRemove).not.toHaveBeenCalled();
  });

  it('should remove user from team when assigned via team and allowTeamRemoval is true', async () => {
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: {
        pending_cancellation_date: null,
        assigning_team: { name: 'copilot-team' },
      },
    });

    const result = await removeCopilotLicense({
      ...defaultParams,
      allowTeamRemoval: true,
    });

    expect(result).toBe(true);
    expect(removeCopilotUserFromTeam).toHaveBeenCalledWith({
      username: 'testuser',
      octokit: mockOctokit,
      org: 'test-org',
      dryRun: false,
    });
    expect(revokeCopilotLicense).not.toHaveBeenCalled();
    expect(mockActivityRemove).toHaveBeenCalledWith('testuser');
  });

  it('should revoke license when not assigned via team', async () => {
    const result = await removeCopilotLicense(defaultParams);

    expect(result).toBe(true);
    expect(revokeCopilotLicense).toHaveBeenCalledWith({
      logins: 'testuser',
      octokit: mockOctokit,
      org: 'test-org',
      dryRun: false,
    });
    expect(removeCopilotUserFromTeam).not.toHaveBeenCalled();
    expect(mockActivityRemove).toHaveBeenCalledWith('testuser');
  });

  it('should not update activity when account removal fails', async () => {
    vi.mocked(revokeCopilotLicense).mockResolvedValue(false);

    const result = await removeCopilotLicense(defaultParams);

    expect(result).toBe(false);
    expect(mockActivityRemove).not.toHaveBeenCalled();
  });
});
