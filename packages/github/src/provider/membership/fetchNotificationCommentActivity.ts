import { pickLatestRecord } from 'dormant-accounts';
import type { LastActivityRecord } from 'dormant-accounts';
import type { logger as dormancyLogger } from 'dormant-accounts/utils';
import { getNotifications } from '../getNotifications';
import type { OctokitClient } from '../types';
import type { NotificationCommentSource } from './types';

/**
 * Activity type recorded for a comment on a user's own notification issue
 */
export const NOTIFICATION_COMMENT_ACTIVITY_TYPE = 'notification-comment';

/**
 * Options for {@link fetchNotificationCommentActivity}
 */
export interface FetchNotificationCommentActivityOptions
  extends NotificationCommentSource {
  octokit: OctokitClient;
  logger: Pick<typeof dormancyLogger, 'debug'>;
}

/**
 * Returns activity for users who commented on their own open notification
 * issue. An issue belongs to the user whose login matches its title,
 * case-insensitively, and must carry every base label.
 *
 * @param options - Fetch options
 * @returns One record per commenting user, dated at their newest comment
 */
export const fetchNotificationCommentActivity = async ({
  octokit,
  owner,
  repo,
  baseLabels,
  logger,
}: FetchNotificationCommentActivityOptions): Promise<LastActivityRecord[]> => {
  const issues = await getNotifications({
    octokit,
    owner,
    repo,
    params: { state: 'open', labels: baseLabels.join(',') },
  });

  const loginByIssueNumber = new Map<number, string>();
  let since: string | undefined;

  for (const issue of issues) {
    if (issue.pull_request) continue;

    loginByIssueNumber.set(issue.number, issue.title.trim().toLowerCase());
    if (!since || Date.parse(issue.created_at) < Date.parse(since)) {
      since = issue.created_at;
    }
  }

  if (!since) {
    logger.debug(`No open notification issues in ${owner}/${repo}`);
    return [];
  }

  const comments = await octokit.paginate(
    octokit.rest.issues.listCommentsForRepo,
    { owner, repo, since, per_page: 100 },
  );

  const latest = new Map<string, LastActivityRecord>();

  for (const comment of comments) {
    const issueNumber = Number(comment.issue_url.split('/').pop());
    const login = comment.user?.login?.toLowerCase();
    if (!login || loginByIssueNumber.get(issueNumber) !== login) continue;

    latest.set(
      login,
      pickLatestRecord(latest.get(login), {
        login,
        lastActivity: new Date(comment.created_at),
        type: NOTIFICATION_COMMENT_ACTIVITY_TYPE,
      }),
    );
  }

  logger.debug(
    `Found notification comment activity for ${latest.size} accounts in ${owner}/${repo}`,
  );

  return [...latest.values()];
};
