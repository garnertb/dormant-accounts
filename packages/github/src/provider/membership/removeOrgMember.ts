import type { NotificationIssue } from '../getExistingNotification';
import type { RemoveAccountHandler, RemoveAccountOutcome } from '../notifier';
import type { OctokitClient } from '../types';

/**
 * Options shared by every {@link removeOrgMember} call
 */
export interface RemoveOrgMemberOptions {
  /** Client allowed to manage organization membership */
  octokit: OctokitClient;
  /** Client used to read notification comments; defaults to `octokit` */
  notificationsOctokit?: OctokitClient;
  org: string;
  /** Repository holding notification issues */
  repository: { owner: string; repo: string };
}

/**
 * Arguments for {@link removeOrgMember}
 */
export interface RemoveOrgMemberArgs extends RemoveOrgMemberOptions {
  login: string;
  notification: Pick<NotificationIssue, 'number'>;
}

const hasStatus = (error: unknown, status: number) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  error.status === status;

/**
 * Removes a dormant account from an organization after re-reading its current
 * state.
 *
 * - Any comment by the user on the notification issue, or a failure to read
 *   the comments, skips removal.
 * - Owners are skipped.
 * - Active members are removed with `orgs.removeMembershipForUser`.
 * - Accounts in a freshly fetched outside collaborator list are removed with
 *   `orgs.removeOutsideCollaborator`.
 * - Anyone else is reported as already absent.
 *
 * Errors other than a 404 from the membership lookup are thrown; the membership
 * kind is never inferred from an error.
 *
 * @param args - Removal arguments
 * @returns The removal outcome
 */
export const removeOrgMember = async ({
  octokit,
  notificationsOctokit = octokit,
  org,
  repository: { owner, repo },
  login,
  notification,
}: RemoveOrgMemberArgs): Promise<RemoveAccountOutcome> => {
  const username = login.toLowerCase();

  try {
    const comments = await notificationsOctokit.paginate(
      notificationsOctokit.rest.issues.listComments,
      { owner, repo, issue_number: notification.number, per_page: 100 },
    );

    if (comments.some((c) => c.user?.login?.toLowerCase() === username)) {
      console.warn(
        `${login} commented on notification #${notification.number}; skipping removal`,
      );
      return 'skipped';
    }
  } catch (error) {
    console.warn(
      `Could not read comments on notification #${notification.number} for ${login}; skipping removal`,
      error,
    );
    return 'skipped';
  }

  let membership:
    | Awaited<
        ReturnType<OctokitClient['rest']['orgs']['getMembershipForUser']>
      >['data']
    | null = null;

  try {
    ({ data: membership } = await octokit.rest.orgs.getMembershipForUser({
      org,
      username: login,
    }));
  } catch (error) {
    if (!hasStatus(error, 404)) throw error;
  }

  if (membership?.role === 'admin') {
    console.warn(`${login} is an owner of ${org}; skipping removal`);
    return 'skipped';
  }

  if (membership?.state === 'active' && membership.role === 'member') {
    await octokit.rest.orgs.removeMembershipForUser({ org, username: login });
    console.info(`Removed ${login} from ${org}`);
    return 'removed';
  }

  const collaborators = await octokit.paginate(
    octokit.rest.orgs.listOutsideCollaborators,
    { org, per_page: 100 },
  );

  if (collaborators.some((c) => c?.login?.toLowerCase() === username)) {
    await octokit.rest.orgs.removeOutsideCollaborator({
      org,
      username: login,
    });
    console.info(`Removed outside collaborator ${login} from ${org}`);
    return 'removed';
  }

  console.info(`${login} is no longer in ${org}`);
  return 'already-absent';
};

/**
 * Creates a notifier `removeAccount` handler that calls {@link removeOrgMember}
 *
 * @param options - Options shared by every removal
 * @returns A handler for {@link GithubIssueNotifier}
 */
export const createRemoveOrgMemberHandler =
  (options: RemoveOrgMemberOptions): RemoveAccountHandler =>
  ({ lastActivityRecord, notification }) =>
    removeOrgMember({
      ...options,
      login: lastActivityRecord.login,
      notification,
    });
