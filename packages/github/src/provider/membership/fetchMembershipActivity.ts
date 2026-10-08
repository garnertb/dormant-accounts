import { dedupeActivityRecords } from 'dormant-accounts';
import type {
  FetchActivityHandler,
  LastActivityRecord,
} from 'dormant-accounts';
import { fetchCopilotSeatActivity } from '../copilot/fetchLatestActivityFromCopilot';
import {
  assertActivityGapWithinRetention,
  auditLogQueryStart,
  fetchAuditLogActivitySince,
} from './fetchAuditLogActivitySince';
import { fetchNotificationCommentActivity } from './fetchNotificationCommentActivity';
import { listInScopeLogins } from './listInScopeLogins';
import type { GitHubMembershipConfig } from './types';

/**
 * Activity type recorded for an in-scope account with no activity in any source
 */
export const NO_ACTIVITY_TYPE = 'no-activity';

const fromSource = async <T>(source: string, pending: Promise<T>) => {
  try {
    return await pending;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch ${source}: ${reason}`, { cause: error });
  }
};

const toCopilotActivity = (record: LastActivityRecord): LastActivityRecord => ({
  ...record,
  type: record.type ? `copilot:${record.type}` : 'copilot',
});

/**
 * Fetches a complete activity snapshot for every account in scope. Each
 * account gets its newest activity across the audit log and, when enabled,
 * Copilot seats and notification comments, or a `null` date when none is found.
 *
 * Any source error, an empty member list or an activity gap longer than the
 * audit log's git-event retention throws before anything is written.
 *
 * @returns One record per in-scope account
 */
export const fetchMembershipActivity: FetchActivityHandler<
  GitHubMembershipConfig
> = async ({
  lastFetchTime,
  octokit,
  org,
  logger,
  checkType,
  includeOutsideCollaborators = false,
  includeCopilotActivity = false,
  countNotificationComments,
  allowActivityGap = false,
  authenticatedAtBehavior = 'ignore',
}) => {
  const lastRun = new Date(lastFetchTime);
  assertActivityGapWithinRetention({ lastRun, allowActivityGap, logger });

  const since = auditLogQueryStart(lastRun);

  const [inScope, ...activity] = await Promise.all([
    fromSource(
      'organization members',
      listInScopeLogins({ octokit, org, includeOutsideCollaborators }),
    ),
    fromSource(
      'audit log activity',
      fetchAuditLogActivitySince({ octokit, org, since, logger }),
    ),
    includeCopilotActivity
      ? fromSource(
          'Copilot seat activity',
          fetchCopilotSeatActivity({
            octokit,
            org,
            logger,
            checkType,
            authenticatedAtBehavior,
            includePendingCancellation: true,
          }).then((records) => records.map(toCopilotActivity)),
        )
      : Promise.resolve([]),
    countNotificationComments
      ? fromSource(
          'notification comment activity',
          fetchNotificationCommentActivity({
            ...countNotificationComments,
            octokit: countNotificationComments.octokit ?? octokit,
            logger,
          }),
        )
      : Promise.resolve([]),
  ]);

  const latest = dedupeActivityRecords(activity.flat());

  const records = [...inScope].sort().map(
    (login): LastActivityRecord =>
      latest.get(login) ?? {
        login,
        lastActivity: null,
        type: NO_ACTIVITY_TYPE,
      },
  );

  logger.info(
    `Found ${inScope.size} accounts in scope, ${records.filter((record) => record.lastActivity).length} with activity since ${since.toISOString()}`,
  );

  return records;
};
