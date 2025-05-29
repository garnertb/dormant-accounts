import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isTeamIdpSynced } from './isTeamIdpSynced';
import type { OctokitClient } from '../types';

describe('isTeamIdpSynced', () => {
  // Setup mock Octokit with properly typed mock function
  const mockOctokit = {
    request: vi.fn(),
  } as unknown as OctokitClient & {
    request: ReturnType<typeof vi.fn>;
  };

  const params = {
    octokit: mockOctokit,
    org: 'test-org',
    team_slug: 'test-team',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return true when team has IdP group mappings', async () => {
    // Mock a response with group mappings
    mockOctokit.request.mockResolvedValueOnce({
      data: {
        groups: [{ id: 'group1' }, { id: 'group2' }],
      },
    });

    const result = await isTeamIdpSynced(params);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'GET /orgs/{org}/teams/{team_slug}/team-sync/group-mappings',
      {
        org: 'test-org',
        team_slug: 'test-team',
      },
    );
    expect(result).toBe(true);
  });

  it('should return false when team has no IdP group mappings', async () => {
    // Mock a response with empty groups
    mockOctokit.request.mockResolvedValueOnce({
      data: {
        groups: [],
      },
    });

    const result = await isTeamIdpSynced(params);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'GET /orgs/{org}/teams/{team_slug}/team-sync/group-mappings',
      {
        org: 'test-org',
        team_slug: 'test-team',
      },
    );
    expect(result).toBe(false);
  });

  it('should return false when team is not externally managed (403 error)', async () => {
    // Mock a 403 error response indicating team is not externally managed
    const error = {
      status: 403,
      response: {
        data: {
          message:
            'This team is not externally managed. Learn more at https://docs.github.com/articles/synchronizing-teams-between-your-identity-provider-and-github',
          documentation_url:
            'https://docs.github.com/rest/teams/team-sync#list-idp-groups-for-a-team',
          status: '403',
        },
      },
    };
    mockOctokit.request.mockRejectedValueOnce(error);

    const result = await isTeamIdpSynced(params);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'GET /orgs/{org}/teams/{team_slug}/team-sync/group-mappings',
      {
        org: 'test-org',
        team_slug: 'test-team',
      },
    );
    expect(result).toBe(false);
  });

  it('should throw an error when API call fails with other errors', async () => {
    const error = new Error('API error');
    mockOctokit.request.mockRejectedValueOnce(error);

    await expect(isTeamIdpSynced(params)).rejects.toThrow(error);

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'GET /orgs/{org}/teams/{team_slug}/team-sync/group-mappings',
      {
        org: 'test-org',
        team_slug: 'test-team',
      },
    );
  });

  it('should throw an error when 403 error does not indicate non-externally managed team', async () => {
    // Mock a 403 error response with different message
    const error = {
      status: 403,
      response: {
        data: {
          message: 'Insufficient permissions to access team sync data',
        },
      },
    };
    mockOctokit.request.mockRejectedValueOnce(error);

    await expect(isTeamIdpSynced(params)).rejects.toThrow();

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'GET /orgs/{org}/teams/{team_slug}/team-sync/group-mappings',
      {
        org: 'test-org',
        team_slug: 'test-team',
      },
    );
  });
});
