import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Low } from 'lowdb';
import { dormancyCheck, FIRST_SEEN_ACTIVITY_TYPE } from '.';
import type { DormancyCheckConfig, LastActivityRecord } from './types';
import { logger } from './utils';

logger.mockTypes(() => vi.fn());

const CHECK_TYPE = 'merge-latest-test';

const record = (
  login: string,
  lastActivity: string | null,
  type = 'audit',
): LastActivityRecord => ({
  login,
  lastActivity: lastActivity ? new Date(lastActivity) : null,
  type,
});

describe('latest merge strategy with a real database', () => {
  let dir: string;
  let dbPath: string;

  const readDb = async () => JSON.parse(await readFile(dbPath, 'utf8'));

  const createCheck = (
    fetchLatestActivity: DormancyCheckConfig<object>['fetchLatestActivity'],
    overrides: Partial<DormancyCheckConfig<object>> = {},
  ) =>
    dormancyCheck<object>({
      type: CHECK_TYPE,
      dbPath,
      duration: '90d',
      activityResultType: 'complete',
      activityMergeStrategy: 'latest',
      firstSeenBaseline: true,
      fetchLatestActivity,
      ...overrides,
    });

  const runAt = async (
    iso: string,
    snapshot: LastActivityRecord[],
    overrides: Partial<DormancyCheckConfig<object>> = {},
  ) => {
    vi.setSystemTime(new Date(iso));
    const check = createCheck(vi.fn().mockResolvedValue(snapshot), overrides);
    await check.fetchActivity();
    return check;
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    dir = await mkdtemp(join(tmpdir(), 'dormant-accounts-'));
    dbPath = join(dir, `${CHECK_TYPE}.json`);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes records, pruning and last run in a single database write', async () => {
    await writeFile(
      dbPath,
      JSON.stringify({
        _state: {
          lastRun: '2025-01-01T00:00:00.000Z',
          'check-type': CHECK_TYPE,
          lastUpdated: '2025-01-01T00:00:00.000Z',
        },
        departed: { lastActivity: '2024-12-01T00:00:00.000Z', type: 'audit' },
        stays: { lastActivity: '2024-12-01T00:00:00.000Z', type: 'audit' },
      }),
    );
    const writeSpy = vi.spyOn(Low.prototype, 'write');

    await runAt('2025-01-02T00:00:00Z', [
      record('stays', '2025-01-01T12:00:00Z'),
      record('joined', '2025-01-01T08:00:00Z'),
    ]);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const data = await readDb();
    expect(Object.keys(data)).toEqual(['_state', 'joined', 'stays']);
    expect(data._state.lastRun).toBe('2025-01-02T00:00:00.000Z');
  });

  it('keeps the newest date, never overwrites with null and collapses mixed-case logins', async () => {
    await writeFile(
      dbPath,
      JSON.stringify({
        _state: {
          lastRun: '2025-01-01T00:00:00.000Z',
          'check-type': CHECK_TYPE,
          lastUpdated: '2025-01-01T00:00:00.000Z',
        },
        'newer-stored': {
          lastActivity: '2024-12-15T00:00:00.000Z',
          type: 'legacy-audit',
        },
        'null-incoming': {
          lastActivity: '2024-10-01T00:00:00.000Z',
          type: 'legacy-audit',
        },
        octocat: {
          lastActivity: '2024-09-01T00:00:00.000Z',
          type: 'legacy-audit',
        },
      }),
    );

    await runAt('2025-01-02T00:00:00Z', [
      record('Newer-Stored', '2024-11-01T00:00:00Z'),
      record('null-incoming', null, 'no-activity'),
      record('OctoCat', '2024-12-01T00:00:00Z', 'audit'),
      record('OCTOCAT', '2024-12-20T00:00:00Z', 'copilot'),
    ]);

    const data = await readDb();
    expect(Object.keys(data)).toEqual([
      '_state',
      'newer-stored',
      'null-incoming',
      'octocat',
    ]);
    expect(data['newer-stored']).toEqual({
      lastActivity: '2024-12-15T00:00:00.000Z',
      type: 'legacy-audit',
    });
    expect(data['null-incoming']).toEqual({
      lastActivity: '2024-10-01T00:00:00.000Z',
      type: 'legacy-audit',
    });
    expect(data.octocat).toEqual({
      lastActivity: '2024-12-20T00:00:00.000Z',
      type: 'copilot',
    });
  });

  it('applies the first-seen baseline across runs, including rejoining members', async () => {
    const firstRun = await runAt('2025-01-01T00:00:00Z', [
      record('silent', null, 'no-activity'),
      record('active', '2024-12-20T00:00:00Z'),
      record('leaver', null, 'no-activity'),
    ]);

    let data = await readDb();
    expect(data._state.rosterInitializedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(data.silent).toEqual({ lastActivity: null, type: 'no-activity' });
    expect(
      (await firstRun.listDormantAccounts()).map(({ login }) => login),
    ).toEqual(['leaver', 'silent']);

    await runAt('2025-01-08T00:00:00Z', [
      record('silent', null, 'no-activity'),
      record('active', null, 'no-activity'),
      record('newcomer', null, 'no-activity'),
    ]);

    data = await readDb();
    expect(data._state.rosterInitializedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(data.silent).toEqual({ lastActivity: null, type: 'no-activity' });
    expect(data.active).toEqual({
      lastActivity: '2024-12-20T00:00:00.000Z',
      type: 'audit',
    });
    expect(data.newcomer).toEqual({
      lastActivity: '2025-01-08T00:00:00.000Z',
      type: FIRST_SEEN_ACTIVITY_TYPE,
    });
    expect(data.leaver).toBeUndefined();

    const thirdRun = await runAt('2025-01-15T00:00:00Z', [
      record('silent', null, 'no-activity'),
      record('active', null, 'no-activity'),
      record('newcomer', null, 'no-activity'),
      record('leaver', null, 'no-activity'),
    ]);

    data = await readDb();
    expect(data.leaver).toEqual({
      lastActivity: '2025-01-15T00:00:00.000Z',
      type: FIRST_SEEN_ACTIVITY_TYPE,
    });
    expect(data.newcomer.lastActivity).toBe('2025-01-08T00:00:00.000Z');
    expect(
      (await thirdRun.listDormantAccounts()).map(({ login }) => login),
    ).toEqual(['silent']);
  });

  it('treats a seeded database without a roster baseline as the initial run', async () => {
    await writeFile(
      dbPath,
      JSON.stringify({
        _state: {
          lastRun: '2025-01-01T00:00:00.000Z',
          'check-type': CHECK_TYPE,
          lastUpdated: '2025-01-01T00:00:00.000Z',
        },
        seeded: {
          lastActivity: '2024-12-01T00:00:00.000Z',
          type: 'legacy-audit',
        },
      }),
    );

    await runAt('2025-01-02T00:00:00Z', [
      record('seeded', null, 'no-activity'),
      record('unseeded', null, 'no-activity'),
    ]);

    const data = await readDb();
    expect(data._state.rosterInitializedAt).toBe('2025-01-02T00:00:00.000Z');
    expect(data.seeded.lastActivity).toBe('2024-12-01T00:00:00.000Z');
    expect(data.unseeded).toEqual({ lastActivity: null, type: 'no-activity' });
  });

  it('prunes the working copy in dry run so counts match a real run', async () => {
    const seed = JSON.stringify({
      _state: {
        lastRun: '2025-01-01T00:00:00.000Z',
        'check-type': CHECK_TYPE,
        lastUpdated: '2025-01-01T00:00:00.000Z',
        rosterInitializedAt: '2024-12-01T00:00:00.000Z',
      },
      departed: { lastActivity: null, type: 'no-activity' },
      stays: { lastActivity: null, type: 'no-activity' },
    });
    const snapshot = [record('stays', null, 'no-activity')];

    await writeFile(dbPath, seed);
    const dryRun = await runAt('2025-01-02T00:00:00Z', snapshot, {
      dryRun: true,
    });
    const dryRunSummary = await dryRun.summarize();

    await writeFile(dbPath, seed);
    const realRun = await runAt('2025-01-02T00:00:00Z', snapshot);

    expect(dryRunSummary).toEqual(await realRun.summarize());
    expect(dryRunSummary.totalAccounts).toBe(1);
  });

  it('rejects the latest strategy combined with a custom logActivityForUser', () => {
    expect(() => createCheck(vi.fn(), { logActivityForUser: vi.fn() })).toThrow(
      /cannot be combined with a custom logActivityForUser/,
    );
  });

  it.each([
    { activityResultType: 'partial' as const },
    { activityMergeStrategy: 'replace' as const },
  ])('rejects firstSeenBaseline with %o', (overrides) => {
    expect(() => createCheck(vi.fn(), overrides)).toThrow(
      /firstSeenBaseline requires/,
    );
  });
});
