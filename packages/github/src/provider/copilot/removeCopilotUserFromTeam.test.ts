import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeCopilotUserFromTeam } from './removeCopilotUserFromTeam';
import * as getTeamDetailsModule from './getTeamDetails';

// Mock the getTeamDetails module
vi.mock('./getTeamDetails', () => ({
  getTeamDetails: vi.fn(),
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
    request: vi.fn(),
  };

  const mockTeamData = {
    id: 123,
    slug: 'copilot-team',
    name: 'copilot-team',
    isIdpSynced: false,
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
    vi.mocked(getTeamDetailsModule.getTeamDetails).mockResolvedValue(
      mockTeamData,
    );
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
    vi.mocked(getTeamDetailsModule.getTeamDetails).mockResolvedValue({
      ...mockTeamData,
      isIdpSynced: true,
    });

    const result = await removeCopilotUserFromTeam(defaultParams);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).not.toHaveBeenCalled();
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it('should not remove user from team in dry run mode', async () => {
    const params = { ...defaultParams, dryRun: true };

    const result = await removeCopilotUserFromTeam(params);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).not.toHaveBeenCalled();
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it('should remove user from team successfully using modern endpoint', async () => {
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
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it('should handle errors and return false', async () => {
    const error = new Error('API error');
    mockOctokit.rest.teams.removeMembershipForUserInOrg.mockRejectedValue(
      error,
    );

    const params = { ...defaultParams, fallbackToLegacy: false };
    const result = await removeCopilotUserFromTeam(params);

    expect(result).toBe(false);
  });

  it('should fallback to legacy endpoint when modern endpoint fails and fallbackToLegacy is true', async () => {
    const modernError = new Error('Modern API error');
    mockOctokit.rest.teams.removeMembershipForUserInOrg.mockRejectedValue(
      modernError,
    );
    mockOctokit.request.mockResolvedValue({} as any);

    const params = {
      ...defaultParams,
      fallbackToLegacy: true,
    };
    const result = await removeCopilotUserFromTeam(params);

    expect(result).toBe(true);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'copilot-team',
      username: 'testuser',
    });
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'DELETE /teams/{team_id}/members/{username}',
      {
        team_id: 123,
        username: 'testuser',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
  });

  it('should not fallback to legacy endpoint when modern endpoint fails and fallbackToLegacy is false', async () => {
    const modernError = new Error('Modern API error');
    mockOctokit.rest.teams.removeMembershipForUserInOrg.mockRejectedValue(
      modernError,
    );

    const params = {
      ...defaultParams,
      fallbackToLegacy: false,
    };
    const result = await removeCopilotUserFromTeam(params);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'copilot-team',
      username: 'testuser',
    });
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it('should handle fallback endpoint errors and return false', async () => {
    const modernError = new Error('Modern API error');
    const legacyError = new Error('Legacy API error');
    mockOctokit.rest.teams.removeMembershipForUserInOrg.mockRejectedValue(
      modernError,
    );
    mockOctokit.request.mockRejectedValue(legacyError);

    const params = {
      ...defaultParams,
      fallbackToLegacy: true,
    };
    const result = await removeCopilotUserFromTeam(params);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'copilot-team',
      username: 'testuser',
    });
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'DELETE /teams/{team_id}/members/{username}',
      {
        team_id: 123,
        username: 'testuser',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
  });

  it('should handle getTeamDetails errors and return false', async () => {
    vi.mocked(getTeamDetailsModule.getTeamDetails).mockRejectedValue(
      new Error('Team data error'),
    );

    const result = await removeCopilotUserFromTeam(defaultParams);

    expect(result).toBe(false);
    expect(
      mockOctokit.rest.teams.removeMembershipForUserInOrg,
    ).not.toHaveBeenCalled();
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });
});
