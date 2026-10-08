import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotificationContext } from './getNotificationContext';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  debug: vi.fn(),
  setFailed: vi.fn(),
}));

const setInputs = (inputs: Record<string, string>) => {
  for (const [name, value] of Object.entries(inputs)) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
};

describe('getNotificationContext', () => {
  beforeEach(() => {
    setInputs({
      'notifications-enabled': 'true',
      'notifications-repo': 'acme/notifications',
      'notifications-duration': '7d',
      'notifications-body': 'body',
      'notifications-dry-run': 'false',
      'assign-user-to-notification-issue': 'true',
      'remove-dormant-accounts': 'true',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(core.setFailed).mockClear();
  });

  it('returns false when notifications are disabled', () => {
    setInputs({ 'notifications-enabled': 'false' });

    expect(getNotificationContext({ baseLabel: 'github-dormancy' })).toBe(
      false,
    );
  });

  it('builds the context with the given base label', () => {
    expect(getNotificationContext({ baseLabel: 'github-dormancy' })).toEqual({
      repo: { owner: 'acme', repo: 'notifications' },
      duration: '7d',
      body: 'body',
      baseLabels: ['github-dormancy'],
      dryRun: false,
      assignUserToIssue: true,
      removeDormantAccounts: true,
    });
  });

  it.each<[string, string]>([
    ['false', 'false'],
    ['false', 'true'],
    ['true', 'false'],
    ['true', 'true'],
  ])(
    'global dry run forces notification dry run and disables removal (notifications-dry-run=%s, remove-dormant-accounts=%s)',
    (notificationsDryRun, removeDormantAccounts) => {
      setInputs({
        'notifications-dry-run': notificationsDryRun,
        'remove-dormant-accounts': removeDormantAccounts,
      });

      expect(
        getNotificationContext({ baseLabel: 'label', dryRun: true }),
      ).toMatchObject({ dryRun: true, removeDormantAccounts: false });
    },
  );

  it('uses the notification inputs when not in global dry run', () => {
    setInputs({
      'notifications-dry-run': 'true',
      'remove-dormant-accounts': 'false',
    });

    expect(
      getNotificationContext({ baseLabel: 'label', dryRun: false }),
    ).toMatchObject({ dryRun: true, removeDormantAccounts: false });
  });

  it.each(['acme', 'acme/', '/repo', 'acme/repo/extra'])(
    'fails on an invalid notifications-repo (%s)',
    (repo) => {
      setInputs({ 'notifications-repo': repo });

      expect(getNotificationContext({ baseLabel: 'label' })).toBe(false);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid notification inputs'),
      );
    },
  );
});
