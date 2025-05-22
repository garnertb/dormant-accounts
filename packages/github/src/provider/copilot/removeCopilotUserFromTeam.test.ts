import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeCopilotUserFromTeam } from './removeCopilotUserFromTeam';
import * as isTeamIdpSyncedModule from './isTeamIdpSynced';

// Mock the isTeamIdpSynced module
vi.mock('./isTeamIdpSynced', () => ({
  isTeamIdpSynced: vi.fn(),
}));

describe('removeCopilotUserFromTeam', () => {
  const mockOctokit = {
    rest: {
      copilot: {
        getCopilotSeatDetailsForUser: vi.fn(),
      },
      teams: {
        removeMembershipForUserInOrg: vi.fn(),
      },
    },
  };

  const defaultParams = {
    username: 'testuser',
    octokit: mockOctokit as any,
    org: 'test-org',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: {
        assigning_team: {
          id: 123,
          name: 'copilot-team',
          slug: 'copilot-team',
        },
      },
    });
  });

  it('should return false if user is not assigned Copilot via a team', async () => {
    mockOctokit.rest.copilot.getCopilotSeatDetailsForUser.mockResolvedValue({
      data: { assigning_team: null },
    });

    const result = await removeCopilotUserFromTeam(defaultParams);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).not.toHaveBeenCalled();
  });

  it('should return false if team is IdP synced', async () => {
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(true);

    const result = await removeCopilotUserFromTeam(defaultParams);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).not.toHaveBeenCalled();
  });

  it('should not remove user from team in dry run mode', async () => {
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(false);
    const params = { ...defaultParams, dryRun: true };

    const result = await removeCopilotUserFromTeam(params);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).not.toHaveBeenCalled();
  });

  it('should remove user from team successfully', async () => {
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(false);
    mockOctokit.rest.teams.removeMembershipForUserInOrg.mockResolvedValue(
      {} as any,
    );

    const result = await removeCopilotUserFromTeam(defaultParams);

    expect(result).toBe(true);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'copilot-team',
      username: 'testuser',
    });
  });

  it('should handle errors and return false', async () => {
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(false);
    const error = new Error('API error');
    mockOctokit.rest.teams.removeMembershipForUserInOrg.mockRejectedValue(
      error,
    );

    const result = await removeCopilotUserFromTeam(defaultParams);

    expect(result).toBe(false);
  });
});
