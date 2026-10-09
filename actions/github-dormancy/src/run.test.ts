import { readFileSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import * as core from '@actions/core';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeGitHub,
  httpError,
  type FakeEndpoint,
  type FakeGitHub,
  type FakeGitHubInit,
} from './testing/fakeGitHub';
import { run } from './run';

const holder = vi.hoisted(() => ({
  github: undefined as FakeGitHub | undefined,
}));

vi.mock('@actions/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actions/core')>();
  const summary: Record<string, unknown> = {};
  for (const method of [
    'addHeading',
    'addRaw',
    'addBreak',
    'addTable',
    'addList',
    'addEOL',
  ]) {
    summary[method] = vi.fn(() => summary);
  }
  summary.write = vi.fn(async () => summary);

  return {
    ...actual,
    debug: vi.fn(),
    info: vi.fn(),
    notice: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    isDebug: vi.fn(() => false),
    summary,
  };
});

vi.mock('@dormant-accounts/action-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@dormant-accounts/action-utils')>();
  return {
    ...actual,
    createThrottledOctokit: vi.fn(({ token }: { token: string }) => {
      if (!holder.github) throw new Error('Fake GitHub is not set up');
      return holder.github.client(token);
    }),
  };
});

const NOW = new Date('2025-06-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const iso = (days: number) => daysAgo(days).toISOString();

const LOG = {
  repo: 'acme/dormancy-log',
  branch: 'github-dormancy',
  path: 'github-dormancy.json',
};
const NOTIFICATIONS_REPO = 'acme/notifications';
const NOTIFICATION_LABELS = ['github-dormancy', 'pending-removal'];

const GITHUB_CONTEXT: Record<string, string> = {
  'github.repository_owner': 'acme',
  'github.repository': 'acme/automation',
  'github.token': 'github-token',
};

const actionDefinition = parse(
  readFileSync(
    fileURLToPath(new URL('../action.yml', import.meta.url)),
    'utf8',
  ),
) as { inputs: Record<string, { default?: unknown }> };

/** Inputs as the runner passes them when a workflow sets none */
const DEFAULT_INPUTS = Object.fromEntries(
  Object.entries(actionDefinition.inputs).map(([name, input]) => [
    name,
    String(input.default ?? '').replace(
      /\$\{\{\s*([\w.]+)\s*\}\}/g,
      (_, expression: string) => GITHUB_CONTEXT[expression] ?? '',
    ),
  ]),
);

const BASE_INPUTS = {
  token: 'org-token',
  'activity-log-token': 'log-token',
  'notifications-token': 'issues-token',
  'activity-log-repo': LOG.repo,
  'notifications-repo': NOTIFICATIONS_REPO,
};

const NOTIFY = { 'notifications-enabled': 'true' };
const NOTIFY_AND_REMOVE = { ...NOTIFY, 'remove-dormant-accounts': 'true' };

const legacyRecord = (days: number) => ({
  lastActivity: iso(days),
  type: 'legacy-audit',
});

/** An activity log seeded from legacy data, as the USPS migration does */
const seedLog = (lastRunDaysAgo = 1) => ({
  _state: {
    lastRun: iso(lastRunDaysAgo),
    'check-type': 'github-dormancy',
    lastUpdated: iso(lastRunDaysAgo),
  },
  alice: legacyRecord(100),
  bob: legacyRecord(120),
  carol: legacyRecord(200),
  erin: legacyRecord(95),
  frank: legacyRecord(10),
});

const auditEntry = (actor: string, action: string, days: number) => ({
  actor,
  action,
  '@timestamp': daysAgo(days).getTime(),
});

/**
 * Members alice, bob, carol, erin and gina, owner olivia, and open
 * notifications for carol (expired), dave (departed), erin (active again) and
 * olivia (owner). Issue #5 has bob's title under another label.
 */
const createFixture = ({
  seed = seedLog(),
  ...init
}: Partial<FakeGitHubInit> & { seed?: object | null } = {}) => {
  const github = createFakeGitHub({
    org: 'acme',
    members: ['alice', 'bob', 'carol', 'erin', 'gina'],
    owners: ['olivia'],
    auditEntries: [
      auditEntry('alice', 'git.clone', 2),
      auditEntry('erin', 'git.push', 2),
      auditEntry('bob', 'pull_request.create', 30),
      auditEntry('olivia', 'git.push', 1),
    ],
    ...init,
  });

  if (seed) github.putFile(LOG, seed);

  for (const [title, days] of [
    ['carol', 30],
    ['dave', 10],
    ['erin', 5],
    ['olivia', 20],
  ] as const) {
    github.addIssue({
      repo: NOTIFICATIONS_REPO,
      title,
      created_at: iso(days),
      labels: [...NOTIFICATION_LABELS],
    });
  }
  github.addIssue({
    repo: NOTIFICATIONS_REPO,
    title: 'bob',
    created_at: iso(3),
    labels: ['other-label'],
  });

  holder.github = github;
  return github;
};

const setInputs = (overrides: Record<string, string>) => {
  for (const [name, value] of Object.entries({
    ...DEFAULT_INPUTS,
    ...BASE_INPUTS,
    ...overrides,
  })) {
    vi.stubEnv(`INPUT_${name.replace(/ /g, '_').toUpperCase()}`, value);
  }
};

const runAction = async (overrides: Record<string, string> = {}) => {
  vi.mocked(core.setOutput).mockClear();
  setInputs(overrides);
  await run();
};

const outputs = (): Record<string, string> =>
  Object.fromEntries(vi.mocked(core.setOutput).mock.calls);

const jsonOutput = (name: string) => {
  const value = outputs()[name];
  if (value === undefined) throw new Error(`Output ${name} was not set`);
  return JSON.parse(value);
};

const logins = (records: Array<{ login: string }>) =>
  records.map(({ login }) => login);

const users = (entries: Array<{ user: string }>) =>
  entries.map(({ user }) => user).sort();

const notificationFor = (github: FakeGitHub, title: string) =>
  github.state.issues.find(
    (issue) =>
      issue.repo === NOTIFICATIONS_REPO &&
      issue.title === title &&
      issue.labels.includes('github-dormancy'),
  );

const originalCwd = process.cwd();
const tempDirs: string[] = [];

const enterTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'github-dormancy-'));
  tempDirs.push(dir);
  process.chdir(dir);
};

describe('run', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
    await enterTempDir();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    holder.github = undefined;
  });

  it('migrates a legacy log, then notifies, removes and closes notifications', async () => {
    const github = createFixture();

    await runAction(NOTIFY_AND_REMOVE);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(logins(jsonOutput('dormant-users'))).toEqual([
      'bob',
      'carol',
      'gina',
    ]);
    expect(logins(jsonOutput('active-users'))).toEqual(['alice', 'erin']);
    expect(outputs()['last-activity-fetch']).toBe(NOW.toISOString());
    expect(jsonOutput('check-stats')).toEqual({
      lastActivityFetch: NOW.toISOString(),
      totalAccounts: 5,
      activeAccounts: 2,
      dormantAccounts: 3,
      activeAccountPercentage: 40,
      dormantAccountPercentage: 60,
      duration: '90d',
    });

    // Owners are never in scope, the audit log is read from 7 days before the
    // last run, and frank, who left the organization, is pruned
    expect(github.callsTo('orgs.listMembers')[0]?.params).toMatchObject({
      org: 'acme',
      role: 'member',
    });
    expect(github.callsTo('auditLog')[0]?.params).toMatchObject({
      org: 'acme',
      include: 'all',
      phrase: `created:>=${iso(8)}`,
    });
    expect(github.readFile(LOG)).toEqual({
      _state: {
        lastRun: NOW.toISOString(),
        'check-type': 'github-dormancy',
        lastUpdated: NOW.toISOString(),
        rosterInitializedAt: NOW.toISOString(),
      },
      alice: { lastActivity: iso(2), type: 'git.clone' },
      bob: legacyRecord(120),
      carol: legacyRecord(200),
      erin: { lastActivity: iso(2), type: 'git.push' },
      gina: { lastActivity: null, type: 'no-activity' },
    });

    const results = jsonOutput('notification-results');
    expect(users(results.notified)).toEqual(['bob', 'gina']);
    expect(users(results.removed)).toEqual(['carol']);
    expect(users(results.reactivated)).toEqual(['erin']);
    expect(users(results.departed)).toEqual(['dave', 'olivia']);
    for (const bucket of [
      'excluded',
      'inGracePeriod',
      'skipped',
      'wouldRemove',
      'errors',
    ]) {
      expect(results[bucket], bucket).toEqual([]);
    }

    expect([...github.state.members].sort()).toEqual([
      'alice',
      'bob',
      'erin',
      'gina',
    ]);
    expect(
      github
        .callsTo('orgs.removeMembershipForUser')
        .map(({ params }) => params),
    ).toEqual([{ org: 'acme', username: 'carol' }]);
    expect(github.callsTo('orgs.removeOutsideCollaborator')).toEqual([]);

    const carol = notificationFor(github, 'carol');
    expect(carol).toMatchObject({ state: 'closed' });
    expect(carol?.labels).toEqual(['github-dormancy', 'user-removed']);
    expect(carol?.comments.map(({ body }) => body)).toEqual([
      'Account carol removed due to inactivity after 7d grace period.',
    ]);

    for (const [title, label] of [
      ['erin', 'became-active'],
      ['dave', 'departed'],
      ['olivia', 'departed'],
    ] as const) {
      const issue = notificationFor(github, title);
      expect(issue?.state, title).toBe('closed');
      expect(issue?.labels, title).toEqual(['github-dormancy', label]);
    }

    const bob = notificationFor(github, 'bob');
    expect(bob).toMatchObject({ state: 'open', labels: NOTIFICATION_LABELS });
    expect(bob?.assignees ?? []).toEqual([]);
    expect(bob?.body).toMatch(
      /^@bob\n\nThe acme organization reviews memberships that have been inactive for 90d\./,
    );
    expect(bob?.body).toContain(
      'Be active within **7d** to keep your membership',
    );
    expect(bob?.body).toContain(
      'Accounts that are still inactive after the grace period are removed from the acme organization.',
    );
    expect(bob?.body).not.toContain('{{');
    expect(notificationFor(github, 'gina')?.body).toContain(
      'Last recorded activity: None',
    );

    // Another label's issue with a dormant user's title is left alone
    expect(github.state.issues[4]).toMatchObject({
      title: 'bob',
      state: 'open',
      labels: ['other-label'],
      comments: [],
    });

    // The log is saved before anything is notified or removed
    expect(github.writes()[0]).toMatchObject({
      endpoint: 'repos.createOrUpdateFileContents',
      params: {
        owner: 'acme',
        repo: 'dormancy-log',
        branch: 'github-dormancy',
        path: 'github-dormancy.json',
        message: 'Update GitHub dormancy log for 2025-06-15',
      },
    });
    expect(core.summary.write).toHaveBeenCalledTimes(1);
  });

  it('uses each token only for the endpoints it is meant for', async () => {
    const github = createFixture({
      seats: [
        {
          assignee: { login: 'gina' },
          created_at: iso(300),
          last_activity_at: iso(200),
          last_activity_editor: 'vscode',
        },
      ],
    });

    await runAction({
      ...NOTIFY_AND_REMOVE,
      'include-copilot-activity': 'true',
      'count-notification-comments': 'true',
    });

    const expectedToken = (endpoint: FakeEndpoint) =>
      endpoint.startsWith('issues.')
        ? 'issues-token'
        : /^(repos|git)\./.test(endpoint)
          ? 'log-token'
          : 'org-token';

    const endpoints = new Set(github.callsTo().map(({ endpoint }) => endpoint));
    expect(endpoints).toEqual(
      new Set([
        'orgs.listMembers',
        'orgs.getMembershipForUser',
        'orgs.removeMembershipForUser',
        'auditLog',
        'copilot.listCopilotSeats',
        'issues.listForRepo',
        'issues.listCommentsForRepo',
        'issues.listComments',
        'issues.create',
        'issues.createComment',
        'issues.addLabels',
        'issues.removeLabel',
        'issues.update',
        'repos.getContent',
        'repos.getBranch',
        'repos.createOrUpdateFileContents',
        'git.getBlob',
      ]),
    );
    for (const { endpoint, token } of github.callsTo()) {
      expect(token, endpoint).toBe(expectedToken(endpoint));
    }
  });

  describe('dry run', () => {
    it.each([
      { notificationsDryRun: 'false', remove: 'false' },
      { notificationsDryRun: 'false', remove: 'true' },
      { notificationsDryRun: 'true', remove: 'false' },
      { notificationsDryRun: 'true', remove: 'true' },
    ])(
      'never notifies, removes or saves with notifications-dry-run $notificationsDryRun and remove-dormant-accounts $remove',
      async ({ notificationsDryRun, remove }) => {
        createFixture();
        await runAction(NOTIFY_AND_REMOVE);
        const expectedStats = jsonOutput('check-stats');
        const expected = jsonOutput('notification-results');

        await enterTempDir();
        const github = createFixture();
        const seed = github.readFile(LOG);

        await runAction({
          ...NOTIFY,
          'dry-run': 'true',
          'notifications-dry-run': notificationsDryRun,
          'remove-dormant-accounts': remove,
        });

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(github.writes()).toEqual([]);
        expect(github.readFile(LOG)).toEqual(seed);
        expect(github.callsTo('issues.listComments')).toEqual([]);
        expect(github.callsTo('orgs.getMembershipForUser')).toEqual([]);

        expect(jsonOutput('check-stats')).toEqual(expectedStats);
        const results = jsonOutput('notification-results');
        expect(users(results.notified)).toEqual(users(expected.notified));
        expect(users(results.reactivated)).toEqual(users(expected.reactivated));
        expect(users(results.departed)).toEqual(users(expected.departed));
        expect(users(results.wouldRemove)).toEqual(users(expected.removed));
        expect(results.removed).toEqual([]);
        expect(results.skipped).toEqual([]);
      },
    );
  });

  describe('fails closed', () => {
    const fail =
      (endpoint: FakeEndpoint, status = 500, message = 'boom') =>
      (github: FakeGitHub) => {
        github.state.failures[endpoint] = httpError(status, message);
      };

    it.each<{
      name: string;
      inputs: Record<string, string>;
      breakGitHub: (github: FakeGitHub) => void;
      error: RegExp;
    }>([
      {
        name: 'a member list error',
        inputs: {},
        breakGitHub: fail('orgs.listMembers'),
        error: /Failed to fetch organization members: boom/,
      },
      {
        name: 'an outside collaborator list error',
        inputs: { 'include-outside-collaborators': 'true' },
        breakGitHub: fail('orgs.listOutsideCollaborators'),
        error: /Failed to fetch organization members: boom/,
      },
      {
        name: 'an audit log error',
        inputs: {},
        breakGitHub: fail('auditLog'),
        error: /Failed to fetch audit log activity: boom/,
      },
      {
        name: 'an audit log 404',
        inputs: {},
        breakGitHub: fail('auditLog', 404, 'Not Found'),
        error: /Failed to fetch audit log activity: Not Found/,
      },
      {
        name: 'a Copilot seat error',
        inputs: { 'include-copilot-activity': 'true' },
        breakGitHub: fail('copilot.listCopilotSeats'),
        error: /Failed to fetch Copilot seat activity: boom/,
      },
      {
        name: 'a notification issue listing error',
        inputs: { 'count-notification-comments': 'true' },
        breakGitHub: fail('issues.listForRepo'),
        error: /Failed to fetch notification comment activity: boom/,
      },
      {
        name: 'a notification comment error',
        inputs: { 'count-notification-comments': 'true' },
        breakGitHub: fail('issues.listCommentsForRepo'),
        error: /Failed to fetch notification comment activity: boom/,
      },
      {
        name: 'an empty member list',
        inputs: {},
        breakGitHub: (github: FakeGitHub) => github.state.members.clear(),
        error: /No members found in organization acme/,
      },
      {
        name: 'an activity log read error',
        inputs: {},
        breakGitHub: fail('git.getBlob'),
        error:
          /Failed to read activity log github-dormancy.json on branch github-dormancy: boom/,
      },
    ])(
      'aborts before any write or notification on $name',
      async ({ inputs, breakGitHub, error }) => {
        const github = createFixture();
        breakGitHub(github);
        const seed = github.readFile(LOG);

        await expect(
          runAction({ ...NOTIFY_AND_REMOVE, ...inputs }),
        ).rejects.toThrow(error);

        expect(github.writes()).toEqual([]);
        expect(github.readFile(LOG)).toEqual(seed);
        expect(outputs()['notification-results']).toBeUndefined();
        expect(outputs().error).toMatch(error);
        expect(core.setFailed).toHaveBeenCalledWith(
          expect.stringMatching(/^Action failed with error: /),
        );
      },
    );

    it('notifies and removes nobody when the activity log cannot be saved', async () => {
      const github = createFixture();
      github.state.failures['repos.createOrUpdateFileContents'] = httpError(
        500,
        'save failed',
      );

      await expect(runAction(NOTIFY_AND_REMOVE)).rejects.toThrow('save failed');

      expect(github.writes().map(({ endpoint }) => endpoint)).toEqual([
        'repos.createOrUpdateFileContents',
      ]);
      expect(outputs()['notification-results']).toBeUndefined();
    });
  });

  describe('activity gap guard', () => {
    it('fails before reading the audit log when the last run is more than 7 days old', async () => {
      const github = createFixture({ seed: seedLog(10) });

      await expect(runAction(NOTIFY_AND_REMOVE)).rejects.toThrow(
        "Last run was 10 days ago, beyond the audit log's 7 days retention for git events",
      );

      expect(github.callsTo('auditLog')).toEqual([]);
      expect(github.writes()).toEqual([]);
    });

    it('reads from 7 days before the last run when allow-activity-gap is set', async () => {
      const github = createFixture({ seed: seedLog(10) });

      await runAction({ 'allow-activity-gap': 'true' });

      expect(github.callsTo('auditLog')[0]?.params.phrase).toBe(
        `created:>=${iso(17)}`,
      );
      expect(github.readFile(LOG)._state.lastRun).toBe(NOW.toISOString());
    });

    it('exempts the first run, which reads the whole audit log and creates the log branch', async () => {
      const github = createFixture({ seed: null });

      await runAction();

      expect(github.callsTo('auditLog')[0]?.params.phrase).toBe(
        `created:>=${new Date(0).toISOString()}`,
      );
      expect(github.callsTo('git.createRef')[0]?.params).toMatchObject({
        owner: 'acme',
        repo: 'dormancy-log',
        ref: 'refs/heads/github-dormancy',
      });
      expect(github.readFile(LOG)._state).toEqual({
        lastRun: NOW.toISOString(),
        'check-type': 'github-dormancy',
        lastUpdated: NOW.toISOString(),
        rosterInitializedAt: NOW.toISOString(),
      });
    });
  });

  it('ignores a stale local activity log when none has been saved', async () => {
    const github = createFixture({ seed: null });
    await writeFile(
      LOG.path,
      JSON.stringify({
        ...seedLog(),
        alice: { lastActivity: iso(1), type: 'stale' },
      }),
    );

    await runAction();

    expect(github.callsTo('auditLog')[0]?.params.phrase).toBe(
      `created:>=${new Date(0).toISOString()}`,
    );
    expect(github.readFile(LOG).alice).toEqual({
      lastActivity: iso(2),
      type: 'git.clone',
    });
  });

  it('gives accounts first seen after the initial run the full threshold, including rejoining members', async () => {
    const github = createFixture();
    await runAction();

    const later = new Date(NOW.getTime() + DAY);
    github.state.members.add('hank');
    github.state.members.add('frank');
    vi.setSystemTime(later);
    await enterTempDir();

    await runAction();

    const log = github.readFile(LOG);
    expect(log._state).toMatchObject({
      lastRun: later.toISOString(),
      rosterInitializedAt: NOW.toISOString(),
    });
    expect(log.hank).toEqual({
      lastActivity: later.toISOString(),
      type: 'first-seen',
    });
    expect(log.frank).toEqual({
      lastActivity: later.toISOString(),
      type: 'first-seen',
    });
    expect(log.gina).toEqual({ lastActivity: null, type: 'no-activity' });
    expect(logins(jsonOutput('dormant-users'))).toEqual([
      'bob',
      'carol',
      'gina',
    ]);
  });

  it('treats excluded users as active, ignoring case and a leading @', async () => {
    createFixture();

    await runAction({ 'exclude-users': 'BOB, @Gina' });

    expect(logins(jsonOutput('active-users'))).toEqual([
      'alice',
      'bob',
      'erin',
      'gina',
    ]);
    expect(logins(jsonOutput('dormant-users'))).toEqual(['carol']);
  });

  it("counts a comment on the commenter's own notification issue, even with notifications disabled", async () => {
    const github = createFixture();
    const comment = (issueNumber: number, login: string) =>
      github.state.issues[issueNumber - 1]?.comments.push({
        login,
        created_at: iso(1),
      });
    comment(1, 'Carol');
    comment(1, 'bob');
    comment(5, 'bob');

    await runAction({ 'count-notification-comments': 'true' });

    expect(
      jsonOutput('active-users').find(
        ({ login }: { login: string }) => login === 'carol',
      ),
    ).toMatchObject({ lastActivity: iso(1), type: 'notification-comment' });
    expect(logins(jsonOutput('dormant-users'))).toEqual(['bob', 'gina']);
    expect(github.callsTo('issues.listForRepo')[0]?.params).toMatchObject({
      owner: 'acme',
      repo: 'notifications',
      state: 'open',
      labels: 'github-dormancy',
    });
    expect(
      github.callsTo('issues.listCommentsForRepo')[0]?.params,
    ).toMatchObject({ owner: 'acme', repo: 'notifications', since: iso(30) });
    expect(
      github.writes().filter(({ endpoint }) => endpoint.startsWith('issues.')),
    ).toEqual([]);
  });

  it('counts Copilot activity from seats pending cancellation', async () => {
    createFixture({
      seats: [
        {
          assignee: { login: 'Bob' },
          created_at: iso(300),
          last_activity_at: iso(3),
          last_activity_editor: 'vscode',
          pending_cancellation_date: '2025-07-01',
        },
      ],
    });

    await runAction({ 'include-copilot-activity': 'true' });

    expect(
      jsonOutput('active-users').find(
        ({ login }: { login: string }) => login === 'bob',
      ),
    ).toMatchObject({ lastActivity: iso(3), type: 'copilot:vscode' });
  });

  describe('ignored audit actions', () => {
    const deauthorizations = ['alice', 'bob', 'gina'].map((login) =>
      auditEntry(login, 'org_credential_authorization.deauthorize', 1),
    );

    it('ignores SAML credential deauthorizations by default', async () => {
      const github = createFixture();
      github.state.auditEntries.push(...deauthorizations);

      await runAction();

      expect(logins(jsonOutput('dormant-users'))).toEqual([
        'bob',
        'carol',
        'gina',
      ]);
      const log = github.readFile(LOG);
      expect(log.alice).toEqual({ lastActivity: iso(2), type: 'git.clone' });
      expect(log.bob).toEqual(legacyRecord(120));
      expect(log.gina).toEqual({ lastActivity: null, type: 'no-activity' });

      const later = new Date(NOW.getTime() + DAY);
      github.state.members.add('hank');
      github.state.auditEntries.push(
        auditEntry('hank', 'org_credential_authorization.deauthorize', 0),
      );
      vi.setSystemTime(later);
      await enterTempDir();

      await runAction();

      expect(github.readFile(LOG).hank).toEqual({
        lastActivity: later.toISOString(),
        type: 'first-seen',
      });
    });

    it('ignores only the listed actions when ignore-audit-actions is set', async () => {
      const github = createFixture();
      github.state.auditEntries.push(
        auditEntry('bob', 'org_credential_authorization.deauthorize', 1),
        auditEntry('gina', 'workflows.completed_workflow_run', 1),
      );

      await runAction({
        'ignore-audit-actions': 'workflows.completed_workflow_run',
      });

      expect(logins(jsonOutput('dormant-users'))).toEqual(['carol', 'gina']);
      const log = github.readFile(LOG);
      expect(log.bob).toEqual({
        lastActivity: iso(1),
        type: 'org_credential_authorization.deauthorize',
      });
      expect(log.gina).toEqual({ lastActivity: null, type: 'no-activity' });
    });

    it('counts every event when ignore-audit-actions is none', async () => {
      const github = createFixture();
      github.state.auditEntries.push(...deauthorizations);

      await runAction({ 'ignore-audit-actions': 'none' });

      expect(logins(jsonOutput('dormant-users'))).toEqual(['carol']);
      expect(github.readFile(LOG).bob).toEqual({
        lastActivity: iso(1),
        type: 'org_credential_authorization.deauthorize',
      });
    });
  });

  describe('removal', () => {
    it('leaves expired notifications open when removal is disabled', async () => {
      const github = createFixture();

      await runAction(NOTIFY);

      const results = jsonOutput('notification-results');
      expect(users(results.skipped)).toEqual(['carol']);
      expect(results.removed).toEqual([]);
      expect(notificationFor(github, 'carol')).toMatchObject({
        state: 'open',
        labels: NOTIFICATION_LABELS,
      });
      expect(github.callsTo('issues.listComments')).toEqual([]);
      expect(github.callsTo('orgs.removeMembershipForUser')).toEqual([]);
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('skips removal when the user comments after activity is fetched', async () => {
      const github = createFixture();
      // The log is saved after activity is fetched and before removal
      github.state.hooks['repos.createOrUpdateFileContents'] = () => {
        github.state.issues[0]?.comments.push({
          login: 'carol',
          created_at: NOW.toISOString(),
        });
      };

      await runAction({
        ...NOTIFY_AND_REMOVE,
        'count-notification-comments': 'true',
      });

      expect(logins(jsonOutput('dormant-users'))).toContain('carol');
      expect(users(jsonOutput('notification-results').skipped)).toEqual([
        'carol',
      ]);
      expect(notificationFor(github, 'carol')?.state).toBe('open');
      expect(github.callsTo('orgs.removeMembershipForUser')).toEqual([]);
    });

    it('reports a failed removal after processing every notification and leaves the issue open', async () => {
      const github = createFixture();
      github.state.failures['orgs.removeMembershipForUser'] = httpError(
        500,
        'removal failed',
      );

      await runAction(NOTIFY_AND_REMOVE);

      const results = jsonOutput('notification-results');
      expect(results.removed).toEqual([]);
      expect(results.errors).toEqual([
        { user: 'carol', error: 'removal failed' },
      ]);
      expect(users(results.notified)).toEqual(['bob', 'gina']);
      expect(notificationFor(github, 'carol')).toMatchObject({
        state: 'open',
        labels: NOTIFICATION_LABELS,
      });
      expect(github.state.members.has('carol')).toBe(true);
      expect(core.setFailed).toHaveBeenCalledWith(
        'Action failed due to errors processing notifications: carol: removal failed',
      );
    });

    it('warns and removes nobody when removal is enabled without notifications', async () => {
      const github = createFixture();

      await runAction({ 'remove-dormant-accounts': 'true' });

      expect(core.warning).toHaveBeenCalledWith(
        'remove-dormant-accounts has no effect unless notifications-enabled is true',
      );
      expect(github.writes().map(({ endpoint }) => endpoint)).toEqual([
        'repos.createOrUpdateFileContents',
      ]);
    });
  });

  describe('input validation', () => {
    it.each<{ name: string; inputs: Record<string, string>; error: string }>([
      {
        name: 'a duration without a unit',
        inputs: { duration: '90' },
        error: 'Invalid duration "90"',
      },
      {
        name: 'a duration shorter than a day',
        inputs: { duration: '3m' },
        error: 'Invalid duration "3m"',
      },
      {
        name: 'a grace period shorter than a day',
        inputs: { ...NOTIFY, 'notifications-duration': '12h' },
        error: 'Invalid notifications-duration "12h"',
      },
      {
        name: 'a flag that is not a boolean',
        inputs: { 'dry-run': 'yes' },
        error: 'dry-run',
      },
      {
        name: 'an unknown authenticated-at behavior',
        inputs: { 'authenticated-at-behavior': 'sometimes' },
        error: 'Invalid authenticated-at-behavior "sometimes"',
      },
      {
        name: 'none combined with ignored audit actions',
        inputs: { 'ignore-audit-actions': 'none\ngit.clone' },
        error: 'Invalid ignore-audit-actions "none, git.clone"',
      },
      {
        name: 'an invalid notifications repository',
        inputs: { ...NOTIFY, 'notifications-repo': 'notifications' },
        error: 'Invalid notification inputs',
      },
      {
        name: 'an invalid activity log repository',
        inputs: { 'activity-log-repo': 'dormancy-log' },
        error: 'Invalid activity-log-repo format',
      },
      {
        name: 'a missing token',
        inputs: { token: '' },
        error: 'Input required and not supplied: token',
      },
    ])('fails on $name without calling GitHub', async ({ inputs, error }) => {
      const github = createFixture();

      await expect(runAction(inputs)).rejects.toThrow(error);

      expect(github.callsTo()).toEqual([]);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(error),
      );
    });

    it('accepts durations written out in words', async () => {
      createFixture();

      await runAction({ duration: '90 days' });

      expect(jsonOutput('check-stats')).toMatchObject({
        duration: '90 days',
        dormantAccounts: 3,
      });
    });
  });
});
