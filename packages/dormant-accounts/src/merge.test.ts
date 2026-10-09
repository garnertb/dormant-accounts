import { describe, expect, it } from 'vitest';
import {
  FIRST_SEEN_ACTIVITY_TYPE,
  dedupeActivityRecords,
  mergeActivityRecords,
  pickLatestRecord,
} from './merge';
import type { LastActivityRecord } from './types';

const record = (
  login: string,
  lastActivity: string | null,
  type = 'test',
): LastActivityRecord => ({
  login,
  lastActivity: lastActivity ? new Date(lastActivity) : null,
  type,
});

describe('pickLatestRecord', () => {
  it('returns the candidate when nothing is held', () => {
    const candidate = record('user', '2024-01-01');
    expect(pickLatestRecord(undefined, candidate)).toBe(candidate);
  });

  it('keeps the newer date', () => {
    const older = record('user', '2024-01-01', 'older');
    const newer = record('user', '2024-02-01', 'newer');

    expect(pickLatestRecord(older, newer)).toBe(newer);
    expect(pickLatestRecord(newer, older)).toBe(newer);
  });

  it('never lets a null date replace a date', () => {
    const dated = record('user', '2024-01-01');
    const empty = record('user', null);

    expect(pickLatestRecord(dated, empty)).toBe(dated);
    expect(pickLatestRecord(empty, dated)).toBe(dated);
  });

  it('resolves ties to the candidate', () => {
    const current = record('user', '2024-01-01', 'current');
    const candidate = record('user', '2024-01-01', 'candidate');

    expect(pickLatestRecord(current, candidate)).toBe(candidate);
  });
});

describe('dedupeActivityRecords', () => {
  it('collapses mixed-case duplicates to the latest lowercase record', () => {
    const result = dedupeActivityRecords([
      record('Octocat', '2024-03-01', 'audit'),
      record('OCTOCAT', null, 'none'),
      record('octocat', '2024-01-01', 'copilot'),
      record('Hubot', '2024-02-01'),
    ]);

    expect([...result.keys()]).toEqual(['octocat', 'hubot']);
    expect(result.get('octocat')).toEqual(
      record('octocat', '2024-03-01', 'audit'),
    );
  });
});

describe('mergeActivityRecords', () => {
  it('keeps a newer stored date over an older incoming date', () => {
    const { records } = mergeActivityRecords({
      stored: [record('user', '2024-05-01', 'stored')],
      incoming: [record('user', '2024-01-01', 'incoming')],
      prune: true,
    });

    expect(records).toEqual([record('user', '2024-05-01', 'stored')]);
  });

  it('replaces an older stored date with a newer incoming date', () => {
    const { records } = mergeActivityRecords({
      stored: [record('user', '2024-01-01', 'stored')],
      incoming: [record('user', '2024-05-01', 'incoming')],
      prune: true,
    });

    expect(records).toEqual([record('user', '2024-05-01', 'incoming')]);
  });

  it('never overwrites a stored date with null', () => {
    const { records } = mergeActivityRecords({
      stored: [record('user', '2024-05-01', 'legacy-audit')],
      incoming: [record('user', null, 'no-activity')],
      prune: true,
    });

    expect(records).toEqual([record('user', '2024-05-01', 'legacy-audit')]);
  });

  it('collapses mixed-case logins across stored and incoming records', () => {
    const { records } = mergeActivityRecords({
      stored: [record('Octocat', '2024-01-01', 'stored')],
      incoming: [
        record('OCTOCAT', '2024-02-01', 'audit'),
        record('octocat', '2024-03-01', 'copilot'),
      ],
      prune: true,
    });

    expect(records).toEqual([record('octocat', '2024-03-01', 'copilot')]);
  });

  it('prunes stored accounts missing from a complete snapshot', () => {
    const { records, pruned } = mergeActivityRecords({
      stored: [record('stays', '2024-01-01'), record('departed', '2024-01-01')],
      incoming: [record('stays', null)],
      prune: true,
    });

    expect(records.map(({ login }) => login)).toEqual(['stays']);
    expect(pruned).toEqual(['departed']);
  });

  it('keeps stored accounts missing from a partial result', () => {
    const { records, pruned } = mergeActivityRecords({
      stored: [record('stays', '2024-01-01'), record('absent', '2024-01-01')],
      incoming: [record('stays', '2024-02-01')],
      prune: false,
    });

    expect(records.map(({ login }) => login).sort()).toEqual([
      'absent',
      'stays',
    ]);
    expect(pruned).toEqual([]);
  });

  describe('first-seen baseline', () => {
    const timestamp = new Date('2025-01-01T00:00:00Z');

    it('leaves members without activity null before the roster is initialized', () => {
      const { records, firstSeen } = mergeActivityRecords({
        stored: [],
        incoming: [record('new-member', null, 'no-activity')],
        prune: true,
        firstSeen: { rosterInitialized: false, timestamp },
      });

      expect(records).toEqual([record('new-member', null, 'no-activity')]);
      expect(firstSeen).toEqual([]);
    });

    it('stamps a member first seen after the roster is initialized', () => {
      const { records, firstSeen } = mergeActivityRecords({
        stored: [record('existing', null, 'no-activity')],
        incoming: [
          record('existing', null, 'no-activity'),
          record('New-Member', null, 'no-activity'),
        ],
        prune: true,
        firstSeen: { rosterInitialized: true, timestamp },
      });

      expect(records).toEqual([
        record('existing', null, 'no-activity'),
        {
          login: 'new-member',
          lastActivity: timestamp,
          type: FIRST_SEEN_ACTIVITY_TYPE,
        },
      ]);
      expect(firstSeen).toEqual(['new-member']);
    });

    it('does not stamp a new member who already has activity', () => {
      const { records, firstSeen } = mergeActivityRecords({
        stored: [],
        incoming: [record('new-member', '2024-12-01', 'audit')],
        prune: true,
        firstSeen: { rosterInitialized: true, timestamp },
      });

      expect(records).toEqual([record('new-member', '2024-12-01', 'audit')]);
      expect(firstSeen).toEqual([]);
    });

    it('does not stamp a stored member with no activity', () => {
      const { records, firstSeen } = mergeActivityRecords({
        stored: [record('existing', null, 'no-activity')],
        incoming: [record('existing', null, 'no-activity')],
        prune: true,
        firstSeen: { rosterInitialized: true, timestamp },
      });

      expect(records).toEqual([record('existing', null, 'no-activity')]);
      expect(firstSeen).toEqual([]);
    });
  });
});
