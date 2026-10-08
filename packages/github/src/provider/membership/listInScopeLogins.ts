import type { OctokitClient } from '../types';

/**
 * Options for {@link listInScopeLogins}
 */
export interface ListInScopeLoginsOptions {
  octokit: OctokitClient;
  org: string;
  /**
   * Include outside collaborators
   * @default false
   */
  includeOutsideCollaborators?: boolean;
}

/**
 * Lists the accounts covered by a membership dormancy check: organization
 * members with the `member` role, plus outside collaborators when enabled.
 * Owners are never included.
 *
 * @param options - List options
 * @returns Lowercase logins of every account in scope
 * @throws When the organization has no members, so an empty member list is
 * never treated as a complete snapshot
 */
export const listInScopeLogins = async ({
  octokit,
  org,
  includeOutsideCollaborators = false,
}: ListInScopeLoginsOptions): Promise<Set<string>> => {
  const [members, collaborators] = await Promise.all([
    octokit.paginate(octokit.rest.orgs.listMembers, {
      org,
      role: 'member',
      per_page: 100,
    }),
    includeOutsideCollaborators
      ? octokit.paginate(octokit.rest.orgs.listOutsideCollaborators, {
          org,
          per_page: 100,
        })
      : Promise.resolve([]),
  ]);

  const logins = new Set<string>();

  for (const member of members) {
    if (member?.login) logins.add(member.login.toLowerCase());
  }

  if (logins.size === 0) {
    throw new Error(
      `No members found in organization ${org}; refusing to treat an empty member list as a complete snapshot`,
    );
  }

  for (const collaborator of collaborators) {
    if (collaborator?.login) logins.add(collaborator.login.toLowerCase());
  }

  return logins;
};
