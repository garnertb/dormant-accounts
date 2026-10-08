import type { LastActivityRecord } from './types';

/**
 * Activity type assigned to accounts stamped by the first-seen baseline
 */
export const FIRST_SEEN_ACTIVITY_TYPE = 'first-seen';

/**
 * First-seen baseline settings applied while merging activity
 */
export interface FirstSeenOptions {
  /** True when a previous run already established the roster baseline */
  readonly rosterInitialized: boolean;
  /** Timestamp stamped on accounts first seen after the baseline */
  readonly timestamp: Date;
}

/**
 * Inputs for {@link mergeActivityRecords}
 */
export interface MergeActivityOptions {
  /** Records currently stored in the database */
  readonly stored: readonly LastActivityRecord[];
  /** Records returned by the activity fetcher */
  readonly incoming: readonly LastActivityRecord[];
  /** Drop stored accounts that are absent from the incoming records */
  readonly prune: boolean;
  /** Enables the first-seen baseline when provided */
  readonly firstSeen?: FirstSeenOptions;
}

/**
 * Output of {@link mergeActivityRecords}
 */
export interface MergeActivityResult {
  /** Complete set of records to persist */
  readonly records: LastActivityRecord[];
  /** Logins removed because they were absent from a complete snapshot */
  readonly pruned: string[];
  /** Logins stamped with the first-seen baseline */
  readonly firstSeen: string[];
}

/**
 * Picks the record with the newer activity date. A `null` date never replaces a date,
 * and ties resolve to the candidate.
 * @param current - Record currently held, if any
 * @param candidate - Record competing to replace it
 * @returns The record to keep
 */
export function pickLatestRecord(
  current: LastActivityRecord | undefined,
  candidate: LastActivityRecord,
): LastActivityRecord {
  if (!current) {
    return candidate;
  }

  if (!candidate.lastActivity) {
    return current.lastActivity ? current : candidate;
  }

  if (!current.lastActivity) {
    return candidate;
  }

  return candidate.lastActivity.getTime() >= current.lastActivity.getTime()
    ? candidate
    : current;
}

/**
 * Lowercases logins and collapses duplicates, keeping the latest record per login
 * @param records - Records that may contain mixed-case or duplicate logins
 * @returns Map of lowercase login to its latest record
 */
export function dedupeActivityRecords(
  records: readonly LastActivityRecord[],
): Map<string, LastActivityRecord> {
  const byLogin = new Map<string, LastActivityRecord>();

  for (const record of records) {
    const login = record.login.toLowerCase();
    byLogin.set(
      login,
      pickLatestRecord(byLogin.get(login), { ...record, login }),
    );
  }

  return byLogin;
}

/**
 * Merges fetched activity into stored activity using the `latest` strategy.
 *
 * - Logins are lowercased and deduplicated on both sides.
 * - The newer date wins, and a `null` date never replaces a stored date.
 * - When `prune` is set, stored accounts missing from `incoming` are dropped.
 * - When `firstSeen.rosterInitialized` is set, an incoming account with no stored record
 *   and no activity is stamped with `firstSeen.timestamp` and type `first-seen`.
 *
 * @param options - Stored records, incoming records and merge settings
 * @returns Records to persist plus the logins that were pruned or stamped
 */
export function mergeActivityRecords({
  stored,
  incoming,
  prune,
  firstSeen,
}: MergeActivityOptions): MergeActivityResult {
  const storedByLogin = dedupeActivityRecords(stored);
  const incomingByLogin = dedupeActivityRecords(incoming);
  const merged = new Map<string, LastActivityRecord>();
  const firstSeenLogins: string[] = [];
  const pruned: string[] = [];

  for (const [login, record] of incomingByLogin) {
    const existing = storedByLogin.get(login);

    if (!existing && !record.lastActivity && firstSeen?.rosterInitialized) {
      merged.set(login, {
        ...record,
        lastActivity: firstSeen.timestamp,
        type: FIRST_SEEN_ACTIVITY_TYPE,
      });
      firstSeenLogins.push(login);
      continue;
    }

    merged.set(login, pickLatestRecord(existing, record));
  }

  for (const [login, record] of storedByLogin) {
    if (merged.has(login)) {
      continue;
    }

    if (prune) {
      pruned.push(login);
    } else {
      merged.set(login, record);
    }
  }

  return { records: [...merged.values()], pruned, firstSeen: firstSeenLogins };
}
