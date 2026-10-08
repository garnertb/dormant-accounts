import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeOctokit,
  httpError,
  type FakeOctokitData,
} from './fakeOctokit';
import {
  createRemoveOrgMemberHandler,
  removeOrgMember,
} from './removeOrgMember';

const run = (
  data: FakeOctokitData,
  login = 'alice',
  notificationsData?: FakeOctokitData,
) => {
  const octokit = createFakeOctokit(data);
  const notificationsOctokit = notificationsData
    ? createFakeOctokit(notificationsData)
    : undefined;

  const result = removeOrgMember({
    octokit: octokit as any,
    notificationsOctokit: notificationsOctokit as any,
    org: 'acme',
    repository: { owner: 'acme', repo: 'notifications' },
    login,
    notification: { number: 42 },
  });

  return { octokit, notificationsOctokit, result };
};

const activeMember = { role: 'member', state: 'active' };

describe('removeOrgMember', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('removes an active member', async () => {
    const { octokit, result } = run({ memberships: { alice: activeMember } });

    await expect(result).resolves.toBe('removed');
    expect(octokit.rest.orgs.removeMembershipForUser).toHaveBeenCalledWith({
      org: 'acme',
      username: 'alice',
    });
    expect(octokit.rest.orgs.removeOutsideCollaborator).not.toHaveBeenCalled();
  });

  it('skips removal when the user commented after the activity fetch', async () => {
    const { octokit, result } = run({
      memberships: { alice: activeMember },
      issueComments: { 42: ['github-actions[bot]', 'Alice'] },
    });

    await expect(result).resolves.toBe('skipped');
    expect(octokit.rest.orgs.getMembershipForUser).not.toHaveBeenCalled();
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
  });

  it("does not let another user's comment block removal", async () => {
    const { result } = run({
      memberships: { alice: activeMember },
      issueComments: { 42: ['github-actions[bot]', 'an-admin'] },
    });

    await expect(result).resolves.toBe('removed');
  });

  it('skips removal when the comments cannot be read', async () => {
    const { octokit, result } = run({
      memberships: { alice: activeMember },
      failures: { issueComments: httpError(500) },
    });

    await expect(result).resolves.toBe('skipped');
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
  });

  it('reads comments with the notifications client when provided', async () => {
    const { octokit, notificationsOctokit, result } = run(
      { memberships: { alice: activeMember } },
      'alice',
      { issueComments: { 42: ['alice'] } },
    );

    await expect(result).resolves.toBe('skipped');
    expect(notificationsOctokit?.paginate).toHaveBeenCalledWith(
      notificationsOctokit?.rest.issues.listComments,
      expect.objectContaining({ issue_number: 42 }),
    );
    expect(octokit.paginate).not.toHaveBeenCalled();
  });

  it('skips a member who became an owner', async () => {
    const { octokit, result } = run({
      memberships: { alice: { role: 'admin', state: 'active' } },
    });

    await expect(result).resolves.toBe('skipped');
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
    expect(octokit.rest.orgs.removeOutsideCollaborator).not.toHaveBeenCalled();
  });

  it('removes a member who became an outside collaborator through the collaborator endpoint', async () => {
    const { octokit, result } = run({ outsideCollaborators: ['Alice'] });

    await expect(result).resolves.toBe('removed');
    expect(octokit.rest.orgs.removeOutsideCollaborator).toHaveBeenCalledWith({
      org: 'acme',
      username: 'alice',
    });
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
  });

  it('reports a user who is already gone as already absent', async () => {
    const { octokit, result } = run({ outsideCollaborators: ['someone-else'] });

    await expect(result).resolves.toBe('already-absent');
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
    expect(octokit.rest.orgs.removeOutsideCollaborator).not.toHaveBeenCalled();
  });

  it('does not remove a pending membership through the membership endpoint', async () => {
    const { octokit, result } = run({
      memberships: { alice: { role: 'member', state: 'pending' } },
    });

    await expect(result).resolves.toBe('already-absent');
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
  });

  it('throws on a 403 instead of inferring the membership kind', async () => {
    const { octokit, result } = run({
      memberships: { alice: httpError(403, 'Forbidden') },
      outsideCollaborators: ['alice'],
    });

    await expect(result).rejects.toThrow('Forbidden');
    expect(octokit.rest.orgs.removeMembershipForUser).not.toHaveBeenCalled();
    expect(octokit.rest.orgs.removeOutsideCollaborator).not.toHaveBeenCalled();
  });

  it('throws when the outside collaborator list cannot be read', async () => {
    const { octokit, result } = run({
      failures: { outsideCollaborators: httpError(403, 'Forbidden') },
    });

    await expect(result).rejects.toThrow('Forbidden');
    expect(octokit.rest.orgs.removeOutsideCollaborator).not.toHaveBeenCalled();
  });
});

describe('createRemoveOrgMemberHandler', () => {
  it('removes the login from the activity record', async () => {
    const octokit = createFakeOctokit({ memberships: { bob: activeMember } });
    const handler = createRemoveOrgMemberHandler({
      octokit: octokit as any,
      org: 'acme',
      repository: { owner: 'acme', repo: 'notifications' },
    });

    await expect(
      handler({
        lastActivityRecord: { login: 'bob', lastActivity: null, type: 'x' },
        notification: { number: 9 } as any,
      }),
    ).resolves.toBe('removed');
    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.rest.issues.listComments,
      expect.objectContaining({ issue_number: 9 }),
    );
    expect(octokit.rest.orgs.removeMembershipForUser).toHaveBeenCalledWith({
      org: 'acme',
      username: 'bob',
    });
  });
});
