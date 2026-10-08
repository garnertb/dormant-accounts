import ms from 'ms';
import { pickLatestRecord } from 'dormant-accounts';
import type { LastActivityRecord } from 'dormant-accounts';
import type { logger as dormancyLogger } from 'dormant-accounts/utils';
import type { OctokitClient } from '../types';

/**
 * How long the audit log retains git events
 */
export const AUDIT_LOG_GIT_EVENT_RETENTION_MS = ms('7d');

type AuditLogEntry = {
  '@timestamp'?: number | string;
  action?: string;
  actor?: string | null;
};

/**
 * Returns where an audit log query should start: one git-event retention window
 * before the last run, so late-arriving events are not missed.
 *
 * @param lastRun - When the check last ran; the epoch for a first run
 * @returns The query start, never earlier than the epoch
 */
export const auditLogQueryStart = (lastRun: Date): Date =>
  new Date(Math.max(0, lastRun.getTime() - AUDIT_LOG_GIT_EVENT_RETENTION_MS));

/**
 * Options for {@link assertActivityGapWithinRetention}
 */
export interface ActivityGapOptions {
  /** When the check last ran; the epoch for a first run */
  lastRun: Date;
  /** Current time */
  now?: Date;
  /** Proceed with a warning instead of throwing */
  allowActivityGap?: boolean;
  logger?: Pick<typeof dormancyLogger, 'warn'>;
}

/**
 * Fails when the last run is older than the audit log's git-event retention,
 * since git activity inside the gap can no longer be read. A first run is exempt.
 *
 * @param options - Gap options
 * @throws When the gap exceeds the retention window and `allowActivityGap` is not set
 */
export const assertActivityGapWithinRetention = ({
  lastRun,
  now = new Date(),
  allowActivityGap = false,
  logger,
}: ActivityGapOptions): void => {
  if (lastRun.getTime() <= 0) return;

  const gap = now.getTime() - lastRun.getTime();
  if (gap <= AUDIT_LOG_GIT_EVENT_RETENTION_MS) return;

  const message = `Last run was ${ms(gap, { long: true })} ago, beyond the audit log's ${ms(AUDIT_LOG_GIT_EVENT_RETENTION_MS, { long: true })} retention for git events, so git activity in the gap cannot be read`;

  if (!allowActivityGap) {
    throw new Error(`${message}. Set allowActivityGap to proceed anyway.`);
  }

  logger?.warn(`${message}; proceeding because allowActivityGap is set`);
};

const parseAuditTimestamp = (
  value: AuditLogEntry['@timestamp'],
): Date | null => {
  if (value === undefined || value === null || value === '') return null;

  const date = new Date(
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  );

  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Options for {@link fetchAuditLogActivitySince}
 */
export interface FetchAuditLogActivitySinceOptions {
  octokit: OctokitClient;
  org: string;
  /** Earliest event time to read */
  since: Date;
  logger: Pick<typeof dormancyLogger, 'debug'>;
}

/**
 * Reads the organization audit log and returns the newest event per actor.
 * Unlike the audit log check, every error (including a 404) is thrown.
 *
 * @param options - Fetch options
 * @returns One activity record per actor, keyed by lowercase login
 */
export const fetchAuditLogActivitySince = async ({
  octokit,
  org,
  since,
  logger,
}: FetchAuditLogActivitySinceOptions): Promise<LastActivityRecord[]> => {
  logger.debug(`Fetching audit log for ${org} since ${since.toISOString()}`);

  const latest = new Map<string, LastActivityRecord>();

  for await (const {
    data: entries,
  } of octokit.paginate.iterator<AuditLogEntry>('GET /orgs/{org}/audit-log', {
    org,
    include: 'all',
    phrase: `created:>=${since.toISOString()}`,
    per_page: 100,
    order: 'desc',
  })) {
    for (const entry of entries) {
      const lastActivity = parseAuditTimestamp(entry['@timestamp']);
      if (!entry.actor || !lastActivity) continue;

      const login = entry.actor.toLowerCase();
      latest.set(
        login,
        pickLatestRecord(latest.get(login), {
          login,
          lastActivity,
          type: entry.action || 'audit-log',
        }),
      );
    }
  }

  return [...latest.values()];
};
