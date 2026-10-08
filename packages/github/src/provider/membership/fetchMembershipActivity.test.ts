import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeOctokit,
  httpError,
  type FakeFailure,
  type FakeOctokit,
  type FakeOctokitData,
} from './fakeOctokit';
import {
  fetchMembershipActivity,
  NO_ACTIVITY_TYPE,
} from './fetchMembershipActivity';
import { NOTIFICATION_COMMENT_ACTIVITY_TYPE } from './fetchNotificationCommentActivity';
import type { GitHubMembershipConfig } from './types';

const NOW = new Date('2025-06-30T00:00:00Z');
const EPOCH = new Date(0);

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const notificationSource = {
  owner: 'acme',
  repo: 'notifications',
  baseLabels: ['github-dormancy'],
};

const run = (
  octokit: FakeOctokit,
  conf: Partial<GitHubMembershipConfig> = {},
  lastFetchTime: Date = EPOCH,
) =>
  fetchMembershipActivity({
    lastFetchTime,
    octokit: octokit as any,
    org: 'acme',
    checkType: 'github-dormancy',
    logger: logger as any,
    ...conf,
  } as Parameters<typeof fetchMembershipActivity>[0]);

const auditPhrase = (octokit: FakeOctokit) =>
  octokit.paginate.iterator.mock.calls.find(
    ([route]) => route === 'GET /orgs/{org}/audit-log',
  )?.[1]?.phrase;

describe('fetchMembershipActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns one record per member with the newest activity across sources', async () => {
    const octokit = createFakeOctokit({
      members: ['Alice', 'bob', 'carol', 'dave'],
      auditEntries: [
        {
          actor: 'alice',
          action: 'git.push',
          '@timestamp': Date.parse('2025-06-01T00:00:00Z'),
        },
        {
          actor: 'Bob',
          action: 'repo.create',
          '@timestamp': Date.parse('2025-06-20T00:00:00Z'),
        },
        {
          actor: 'outsider',
          action: 'git.clone',
          '@timestamp': Date.parse('2025-06-25T00:00:00Z'),
        },
      ],
      seats: [
        {
          assignee: { login: 'alice' },
          last_activity_at: '2025-06-10T00:00:00Z',
          last_activity_editor: 'vscode',
          created_at: '2025-01-01T00:00:00Z',
        },
        {
          assignee: { login: 'bob' },
          last_activity_at: '2025-06-05T00:00:00Z',
          last_activity_editor: 'vscode',
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      issues: [
        {
          number: 7,
          title: 'carol',
          created_at: '2025-06-01T00:00:00Z',
          labels: ['github-dormancy'],
        },
      ],
      repoComments: [
        { issue_number: 7, login: 'Carol', created_at: '2025-06-15T00:00:00Z' },
      ],
    });

    const records = await run(octokit, {
      includeCopilotActivity: true,
      countNotificationComments: notificationSource,
    });

    expect(records).toEqual([
      {
        login: 'alice',
        lastActivity: new Date('2025-06-10T00:00:00Z'),
        type: 'copilot:vscode',
      },
      {
        login: 'bob',
        lastActivity: new Date('2025-06-20T00:00:00Z'),
        type: 'repo.create',
      },
      {
        login: 'carol',
        lastActivity: new Date('2025-06-15T00:00:00Z'),
        type: NOTIFICATION_COMMENT_ACTIVITY_TYPE,
      },
      { login: 'dave', lastActivity: null, type: NO_ACTIVITY_TYPE },
    ]);
  });

  it('lists only members with the member role, so owners are never in scope', async () => {
    const octokit = createFakeOctokit({ members: ['alice'] });

    await run(octokit);

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.rest.orgs.listMembers,
      expect.objectContaining({ org: 'acme', role: 'member' }),
    );
    expect(octokit.paginate).not.toHaveBeenCalledWith(
      octokit.rest.orgs.listOutsideCollaborators,
      expect.anything(),
    );
  });

  it('includes outside collaborators when enabled', async () => {
    const octokit = createFakeOctokit({
      members: ['alice'],
      outsideCollaborators: ['Contractor'],
    });

    const records = await run(octokit, { includeOutsideCollaborators: true });

    expect(records.map((record) => record.login)).toEqual([
      'alice',
      'contractor',
    ]);
  });

  it('counts Copilot seats pending cancellation', async () => {
    const octokit = createFakeOctokit({
      members: ['alice'],
      seats: [
        {
          assignee: { login: 'alice' },
          last_activity_at: '2025-06-10T00:00:00Z',
          last_activity_editor: 'vscode',
          created_at: '2025-01-01T00:00:00Z',
          pending_cancellation_date: '2025-07-01',
        },
      ],
    });

    const [record] = await run(octokit, { includeCopilotActivity: true });

    expect(record).toEqual({
      login: 'alice',
      lastActivity: new Date('2025-06-10T00:00:00Z'),
      type: 'copilot:vscode',
    });
  });

  it('skips Copilot and comment sources when disabled', async () => {
    const octokit = createFakeOctokit({ members: ['alice'] });

    const [record] = await run(octokit);

    expect(record).toEqual({
      login: 'alice',
      lastActivity: null,
      type: NO_ACTIVITY_TYPE,
    });
    expect(octokit.paginate.iterator).toHaveBeenCalledTimes(1);
    expect(octokit.paginate).not.toHaveBeenCalledWith(
      octokit.rest.issues.listForRepo,
      expect.anything(),
    );
  });

  describe('fails closed', () => {
    const enabled: Partial<GitHubMembershipConfig> = {
      includeOutsideCollaborators: true,
      includeCopilotActivity: true,
      countNotificationComments: notificationSource,
    };

    const data: FakeOctokitData = {
      members: ['alice'],
      issues: [
        {
          number: 1,
          title: 'alice',
          created_at: '2025-06-01T00:00:00Z',
          labels: ['github-dormancy'],
        },
      ],
    };

    it.each<[string, FakeFailure, unknown]>([
      ['members', 'members', httpError(500)],
      ['outside collaborators', 'outsideCollaborators', httpError(403)],
      ['audit log', 'audit', httpError(500)],
      ['audit log 404', 'audit', httpError(404, 'Not Found')],
      ['Copilot seats', 'copilot', httpError(500)],
      ['notification issues', 'issues', httpError(500)],
      ['notification comments', 'repoComments', httpError(500)],
    ])('throws when %s cannot be read', async (_name, failure, error) => {
      const octokit = createFakeOctokit({
        ...data,
        failures: { [failure]: error },
      });

      await expect(run(octokit, enabled)).rejects.toThrow(/^Failed to fetch/);
    });

    it('throws when the member list is empty', async () => {
      const octokit = createFakeOctokit({
        members: [],
        outsideCollaborators: ['contractor'],
      });

      await expect(
        run(octokit, { includeOutsideCollaborators: true }),
      ).rejects.toThrow(/No members found/);
    });
  });

  describe('activity gap guard', () => {
    it('throws before reading anything when the last run is more than 7 days old', async () => {
      const octokit = createFakeOctokit({ members: ['alice'] });

      await expect(
        run(octokit, {}, new Date('2025-06-22T00:00:00Z')),
      ).rejects.toThrow(/allowActivityGap/);
      expect(octokit.paginate).not.toHaveBeenCalled();
      expect(octokit.paginate.iterator).not.toHaveBeenCalled();
    });

    it('proceeds with a warning when allowActivityGap is set', async () => {
      const octokit = createFakeOctokit({ members: ['alice'] });

      await expect(
        run(
          octokit,
          { allowActivityGap: true },
          new Date('2025-06-22T00:00:00Z'),
        ),
      ).resolves.toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('proceeding because allowActivityGap is set'),
      );
    });

    it('exempts the first run and reads the whole audit log', async () => {
      const octokit = createFakeOctokit({ members: ['alice'] });

      await expect(run(octokit, {}, EPOCH)).resolves.toHaveLength(1);
      expect(auditPhrase(octokit)).toBe('created:>=1970-01-01T00:00:00.000Z');
    });

    it('reads the audit log from 7 days before the last run', async () => {
      const octokit = createFakeOctokit({ members: ['alice'] });

      await run(octokit, {}, new Date('2025-06-29T00:00:00Z'));

      expect(auditPhrase(octokit)).toBe('created:>=2025-06-22T00:00:00.000Z');
    });
  });
});
