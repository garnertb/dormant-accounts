import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getTeamDetails,
  clearTeamDataCache,
  type TeamData,
} from './getTeamDetails';
import * as isTeamIdpSyncedModule from './isTeamIdpSynced';

// Mock the isTeamIdpSynced module
vi.mock('./isTeamIdpSynced', () => ({
  isTeamIdpSynced: vi.fn(),
}));

describe('getTeamDetails', () => {
  const mockOctokit = {
    rest: {
      teams: {
        getByName: vi.fn(),
      },
    },
  };

  const mockTeamResponse = {
    data: {
      id: 123,
      slug: 'test-team',
      name: 'Test Team',
    },
  };

  const expectedTeamData: TeamData = {
    id: 123,
    slug: 'test-team',
    name: 'Test Team',
    isIdpSynced: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    clearTeamDataCache();
    mockOctokit.rest.teams.getByName.mockResolvedValue(mockTeamResponse);
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(false);
  });

  it('should fetch team data and cache it', async () => {
    const result = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });

    expect(result).toEqual(expectedTeamData);
    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'test-team',
    });
    expect(isTeamIdpSyncedModule.isTeamIdpSynced).toHaveBeenCalledWith({
      octokit: mockOctokit,
      org: 'test-org',
      team_slug: 'test-team',
    });
  });

  it('should return cached data on subsequent calls', async () => {
    // First call
    const result1 = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });

    // Second call
    const result2 = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });

    expect(result1).toEqual(expectedTeamData);
    expect(result2).toEqual(expectedTeamData);

    // API should only be called once
    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledTimes(1);
    expect(isTeamIdpSyncedModule.isTeamIdpSynced).toHaveBeenCalledTimes(1);
  });

  it('should handle different teams with separate cache entries', async () => {
    const mockTeamResponse2 = {
      data: {
        id: 456,
        slug: 'another-team',
        name: 'Another Team',
      },
    };

    mockOctokit.rest.teams.getByName
      .mockResolvedValueOnce(mockTeamResponse)
      .mockResolvedValueOnce(mockTeamResponse2);

    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result1 = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });
    const result2 = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'another-team',
    });

    expect(result1).toEqual({
      id: 123,
      slug: 'test-team',
      name: 'Test Team',
      isIdpSynced: false,
    });
    expect(result2).toEqual({
      id: 456,
      slug: 'another-team',
      name: 'Another Team',
      isIdpSynced: true,
    });

    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledTimes(2);
    expect(isTeamIdpSyncedModule.isTeamIdpSynced).toHaveBeenCalledTimes(2);
  });

  it('should handle different organizations with separate cache entries', async () => {
    const result1 = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'org1',
      team_slug: 'test-team',
    });
    const result2 = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'org2',
      team_slug: 'test-team',
    });

    expect(result1).toEqual(expectedTeamData);
    expect(result2).toEqual(expectedTeamData);

    // Should make separate API calls for different orgs
    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledTimes(2);
    expect(mockOctokit.rest.teams.getByName).toHaveBeenNthCalledWith(1, {
      org: 'org1',
      team_slug: 'test-team',
    });
    expect(mockOctokit.rest.teams.getByName).toHaveBeenNthCalledWith(2, {
      org: 'org2',
      team_slug: 'test-team',
    });
  });

  it('should include IdP sync status when team is IdP synced', async () => {
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(true);

    const result = await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });

    expect(result).toEqual({
      ...expectedTeamData,
      isIdpSynced: true,
    });
  });

  it('should handle API errors gracefully', async () => {
    const apiError = new Error('API Error');
    mockOctokit.rest.teams.getByName.mockRejectedValue(apiError);

    await expect(
      getTeamDetails({
        octokit: mockOctokit as any,
        org: 'test-org',
        team_slug: 'test-team',
      }),
    ).rejects.toThrow('API Error');

    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'test-team',
    });
  });

  it('should handle isTeamIdpSynced errors gracefully', async () => {
    const idpError = new Error('IdP Check Error');
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockRejectedValue(
      idpError,
    );

    await expect(
      getTeamDetails({
        octokit: mockOctokit as any,
        org: 'test-org',
        team_slug: 'test-team',
      }),
    ).rejects.toThrow('IdP Check Error');

    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledWith({
      org: 'test-org',
      team_slug: 'test-team',
    });
    expect(isTeamIdpSyncedModule.isTeamIdpSynced).toHaveBeenCalledWith({
      octokit: mockOctokit,
      org: 'test-org',
      team_slug: 'test-team',
    });
  });
});

describe('clearTeamDataCache', () => {
  const mockOctokit = {
    rest: {
      teams: {
        getByName: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockOctokit.rest.teams.getByName.mockResolvedValue({
      data: {
        id: 123,
        slug: 'test-team',
        name: 'Test Team',
      },
    });
    vi.mocked(isTeamIdpSyncedModule.isTeamIdpSynced).mockResolvedValue(false);
  });

  it('should clear the cache and force fresh API calls', async () => {
    // First call - should hit API
    await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });
    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledTimes(1);

    // Second call - should use cache
    await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });
    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledTimes(1);

    // Clear cache
    clearTeamDataCache();

    // Third call - should hit API again
    await getTeamDetails({
      octokit: mockOctokit as any,
      org: 'test-org',
      team_slug: 'test-team',
    });
    expect(mockOctokit.rest.teams.getByName).toHaveBeenCalledTimes(2);
  });
});
