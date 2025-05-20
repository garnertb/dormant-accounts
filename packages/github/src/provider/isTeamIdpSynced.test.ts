import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isTeamIdpSynced } from './isTeamIdpSynced';
import type { OctokitClient } from './types';

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

  it('should throw an error when API call fails', async () => {
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
});
