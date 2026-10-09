import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_SEEN_ACTIVITY_TYPE } from 'dormant-accounts';
import { logger } from 'dormant-accounts/utils';
import { githubMembershipDormancy } from './dormancy';
import {
  createFakeOctokit,
  httpError,
  type FakeOctokitData,
} from './fakeOctokit';
import type { GitHubMembershipConfig } from './types';

logger.mockTypes(() => vi.fn());

const CHECK_TYPE = 'github-dormancy';

describe('githubMembershipDormancy with a real database', () => {
  let dir: string;
  let dbPath: string;

  const readDb = async () => JSON.parse(await readFile(dbPath, 'utf8'));

  const createCheck = (
    data: FakeOctokitData,
    conf: Partial<GitHubMembershipConfig> = {},
  ) =>
    githubMembershipDormancy({
      dbPath,
      duration: '90 days',
      conf: {
        octokit: createFakeOctokit(data) as any,
        org: 'acme',
        ...conf,
      },
    });

  const runAt = async (iso: string, data: FakeOctokitData) => {
    vi.setSystemTime(new Date(iso));
    const check = createCheck(data);
    await check.fetchActivity();
    return check;
  };

  const logins = (records: Array<{ login: string }>) =>
    records.map(({ login }) => login);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    dir = await mkdtemp(join(tmpdir(), 'github-dormancy-'));
    dbPath = join(dir, `${CHECK_TYPE}.json`);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('leaves the database untouched when a source fails', async () => {
    const seeded = JSON.stringify({
      _state: {
        lastRun: '2025-06-27T00:00:00.000Z',
        'check-type': CHECK_TYPE,
        lastUpdated: '2025-06-27T00:00:00.000Z',
      },
      alice: { lastActivity: '2025-06-01T00:00:00.000Z', type: 'git.push' },
    });
    await writeFile(dbPath, seeded);
    vi.setSystemTime(new Date('2025-06-30T00:00:00Z'));

    const check = createCheck({
      members: ['alice'],
      failures: { audit: httpError(404, 'Not Found') },
    });

    await expect(check.fetchActivity()).rejects.toThrow(
      'Failed to fetch audit log activity: Not Found',
    );
    expect(await readFile(dbPath, 'utf8')).toBe(seeded);
  });

  it('migrates a legacy seed: keeps newer stored dates, marks unknown members dormant and prunes departures', async () => {
    await writeFile(
      dbPath,
      JSON.stringify({
        _state: {
          lastRun: '2025-06-27T00:00:00.000Z',
          'check-type': CHECK_TYPE,
          lastUpdated: '2025-06-27T00:00:00.000Z',
        },
        alice: {
          lastActivity: '2025-01-15T00:00:00.000Z',
          type: 'legacy-audit',
        },
        bob: {
          lastActivity: '2025-06-01T00:00:00.000Z',
          type: 'legacy-audit',
        },
        departed: {
          lastActivity: '2025-06-01T00:00:00.000Z',
          type: 'legacy-audit',
        },
      }),
    );

    const check = await runAt('2025-06-30T00:00:00Z', {
      members: ['alice', 'Bob', 'carol'],
      auditEntries: [
        {
          actor: 'bob',
          action: 'git.push',
          '@timestamp': Date.parse('2025-06-25T00:00:00Z'),
        },
      ],
    });

    expect(await readDb()).toEqual({
      _state: {
        lastRun: '2025-06-30T00:00:00.000Z',
        'check-type': CHECK_TYPE,
        lastUpdated: '2025-06-30T00:00:00.000Z',
        rosterInitializedAt: '2025-06-30T00:00:00.000Z',
      },
      alice: {
        lastActivity: '2025-01-15T00:00:00.000Z',
        type: 'legacy-audit',
      },
      bob: { lastActivity: '2025-06-25T00:00:00.000Z', type: 'git.push' },
      carol: { lastActivity: null, type: 'no-activity' },
    });
    expect(logins(await check.listDormantAccounts())).toEqual([
      'alice',
      'carol',
    ]);
  });

  it('gives members first seen after the initial run the full threshold, including rejoining members', async () => {
    await runAt('2025-06-01T00:00:00Z', { members: ['alice', 'bob'] });

    expect((await readDb()).bob).toEqual({
      lastActivity: null,
      type: 'no-activity',
    });

    await runAt('2025-06-02T00:00:00Z', { members: ['alice', 'bob', 'dave'] });

    let db = await readDb();
    expect(db.bob).toEqual({ lastActivity: null, type: 'no-activity' });
    expect(db.dave).toEqual({
      lastActivity: '2025-06-02T00:00:00.000Z',
      type: FIRST_SEEN_ACTIVITY_TYPE,
    });

    await runAt('2025-06-03T00:00:00Z', { members: ['alice', 'dave'] });
    expect((await readDb()).bob).toBeUndefined();

    const check = await runAt('2025-06-04T00:00:00Z', {
      members: ['alice', 'bob', 'dave'],
    });

    db = await readDb();
    expect(db.bob).toEqual({
      lastActivity: '2025-06-04T00:00:00.000Z',
      type: FIRST_SEEN_ACTIVITY_TYPE,
    });
    expect(db._state.rosterInitializedAt).toBe('2025-06-01T00:00:00.000Z');
    expect(logins(await check.listDormantAccounts())).toEqual(['alice']);
  });

  it('never reports bot accounts as dormant', async () => {
    const check = await runAt('2025-06-01T00:00:00Z', {
      members: ['alice', 'deploy[bot]'],
    });

    expect(logins(await check.listDormantAccounts())).toEqual(['alice']);
    expect(logins(await check.listActiveAccounts())).toEqual(['deploy[bot]']);
  });
});
