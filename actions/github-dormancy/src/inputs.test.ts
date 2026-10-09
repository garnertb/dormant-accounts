import { DEFAULT_IGNORED_AUDIT_ACTIONS } from '@dormant-accounts/github';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseIgnoredAuditActions,
  parseLoginList,
  readBooleanInput,
  readInputs,
  validateDuration,
} from './inputs';

const setInputs = (inputs: Record<string, string>) => {
  for (const [name, value] of Object.entries(inputs)) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
};

const REQUIRED = {
  org: 'acme',
  token: 'org-token',
  'activity-log-repo': 'acme/dormancy-log',
  duration: '90d',
};

describe('inputs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('readBooleanInput', () => {
    it.each([true, false])('returns the default %s when empty', (fallback) => {
      setInputs({ flag: '' });
      expect(readBooleanInput('flag', fallback)).toBe(fallback);
    });

    it.each([
      ['true', true],
      ['True', true],
      ['FALSE', false],
    ])('parses %s', (value, expected) => {
      setInputs({ flag: value });
      expect(readBooleanInput('flag', !expected)).toBe(expected);
    });

    it('rejects values that are not booleans, naming the input', () => {
      setInputs({ flag: 'yes' });
      expect(() => readBooleanInput('flag', false)).toThrow(/flag/);
    });
  });

  describe('validateDuration', () => {
    it.each([
      ['90d', '90d'],
      ['90 days', '90 days'],
      [' 13w ', '13w'],
      ['24h', '24h'],
      ['1y', '1y'],
    ])('accepts %j', (value, expected) => {
      expect(validateDuration(value, 'duration')).toBe(expected);
    });

    it.each(['', '90', '3m', '12h', 'ninety days', '-90d'])(
      'rejects %j',
      (value) => {
        expect(() => validateDuration(value, 'duration')).toThrow(
          `Invalid duration "${value}". Expected a duration of at least one day`,
        );
      },
    );
  });

  describe('parseLoginList', () => {
    it('splits on commas, whitespace and newlines, ignoring case and a leading @', () => {
      expect(parseLoginList('BOB, @Gina\ncarol  dave,,\n')).toEqual(
        new Set(['bob', 'gina', 'carol', 'dave']),
      );
    });

    it('returns an empty set for an empty value', () => {
      expect(parseLoginList('')).toEqual(new Set());
    });
  });

  describe('parseIgnoredAuditActions', () => {
    it.each(['', '  ', ' ,\n, '])(
      'returns the default list for %j',
      (value) => {
        expect(parseIgnoredAuditActions(value)).toEqual([
          ...DEFAULT_IGNORED_AUDIT_ACTIONS,
        ]);
      },
    );

    it('replaces the default list, splitting on commas, whitespace and newlines and ignoring case and duplicates', () => {
      expect(
        parseIgnoredAuditActions(
          'Git.Clone, git.clone\nREPO.download  org.add_member,,\n',
        ),
      ).toEqual(['git.clone', 'repo.download', 'org.add_member']);
    });

    it.each(['none', 'NONE', ' None\n'])(
      'counts every action for %j',
      (value) => {
        expect(parseIgnoredAuditActions(value)).toEqual([]);
      },
    );

    it('rejects none combined with other actions', () => {
      expect(() => parseIgnoredAuditActions('none, Git.Clone')).toThrow(
        'Invalid ignore-audit-actions "none, git.clone". Use "none" on its own to count every audit log action',
      );
    });
  });

  describe('readInputs', () => {
    it('applies defaults when optional inputs are empty', () => {
      setInputs(REQUIRED);

      expect(readInputs()).toEqual({
        org: 'acme',
        activityLogRepo: { owner: 'acme', repo: 'dormancy-log' },
        duration: '90d',
        token: 'org-token',
        activityLogToken: 'org-token',
        notificationsToken: 'org-token',
        dryRun: false,
        includeCopilotActivity: false,
        authenticatedAtBehavior: 'ignore',
        notificationCommentsRepo: undefined,
        includeOutsideCollaborators: false,
        excludeUsers: new Set(),
        firstSeenBaseline: true,
        allowActivityGap: false,
        ignoreAuditActions: ['org_credential_authorization.deauthorize'],
      });
    });

    it('reads every optional input', () => {
      setInputs({
        ...REQUIRED,
        duration: '13 weeks',
        'activity-log-token': 'log-token',
        'notifications-token': 'issues-token',
        'dry-run': 'true',
        'include-copilot-activity': 'true',
        'authenticated-at-behavior': 'most-recent',
        'count-notification-comments': 'true',
        'notifications-repo': 'acme/notifications',
        'include-outside-collaborators': 'true',
        'exclude-users': 'Bot-One\n@bot-two',
        'first-seen-baseline': 'false',
        'allow-activity-gap': 'true',
        'ignore-audit-actions':
          'Repo.Download\nworkflows.completed_workflow_run',
      });

      expect(readInputs()).toEqual({
        org: 'acme',
        activityLogRepo: { owner: 'acme', repo: 'dormancy-log' },
        duration: '13 weeks',
        token: 'org-token',
        activityLogToken: 'log-token',
        notificationsToken: 'issues-token',
        dryRun: true,
        includeCopilotActivity: true,
        authenticatedAtBehavior: 'most-recent',
        notificationCommentsRepo: { owner: 'acme', repo: 'notifications' },
        includeOutsideCollaborators: true,
        excludeUsers: new Set(['bot-one', 'bot-two']),
        firstSeenBaseline: false,
        allowActivityGap: true,
        ignoreAuditActions: [
          'repo.download',
          'workflows.completed_workflow_run',
        ],
      });
    });

    it('only parses notifications-repo when comments count as activity', () => {
      setInputs({ ...REQUIRED, 'notifications-repo': 'notifications' });
      expect(readInputs().notificationCommentsRepo).toBeUndefined();

      setInputs({ 'count-notification-comments': 'true' });
      expect(() => readInputs()).toThrow(
        'Invalid notifications-repo format. Expected "owner/repo", got "notifications"',
      );
    });

    it.each([
      [{ token: '' }, 'Input required and not supplied: token'],
      [{ org: '' }, 'Input required and not supplied: org'],
      [
        { 'activity-log-repo': 'acme/dormancy-log/extra' },
        'Invalid activity-log-repo format',
      ],
      [{ duration: '90' }, 'Invalid duration "90"'],
      [
        { 'authenticated-at-behavior': 'always' },
        'Invalid authenticated-at-behavior "always". Expected one of: ignore, fallback, most-recent',
      ],
      [{ 'first-seen-baseline': 'no' }, 'first-seen-baseline'],
      [
        { 'ignore-audit-actions': 'none git.clone' },
        'Invalid ignore-audit-actions "none, git.clone"',
      ],
    ])('rejects %j', (overrides, error) => {
      setInputs({ ...REQUIRED, ...overrides });
      expect(() => readInputs()).toThrow(error);
    });
  });
});
