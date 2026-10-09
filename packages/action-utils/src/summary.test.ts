import * as core from '@actions/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessingResult } from '@dormant-accounts/github';
import { addCheckSummary, addNotificationResultsSummary } from './summary';

const emptyResults = (): ProcessingResult => ({
  notified: [],
  removed: [],
  reactivated: [],
  excluded: [],
  inGracePeriod: [],
  departed: [],
  skipped: [],
  wouldRemove: [],
  errors: [],
});

const entry = (user: string, html_url?: string) =>
  ({
    user,
    notification: { title: user, html_url },
  }) as ProcessingResult['notified'][number];

describe('summary', () => {
  afterEach(() => {
    core.summary.emptyBuffer();
  });

  it('labels the status table columns in data order', () => {
    addCheckSummary({
      heading: 'Check',
      notificationsEnabled: false,
      summary: {
        lastActivityFetch: '2025-01-01T00:00:00.000Z',
        totalAccounts: 4,
        activeAccounts: 3,
        dormantAccounts: 1,
        activeAccountPercentage: 75,
        dormantAccountPercentage: 25,
        duration: '90d',
      },
    });

    const html = core.summary.stringify();
    expect(html).toContain(
      '<tr><th>Account Type</th><th>Count</th><th>Percentage</th></tr>',
    );
    expect(html).toContain(
      '<tr><td>Dormant Accounts</td><td>1</td><td>25.0%</td></tr>',
    );
  });

  it('links issues and lists dry-run entries by title', () => {
    addNotificationResultsSummary(
      {
        ...emptyResults(),
        notified: [entry('bob')],
        departed: [entry('dave', 'https://github.com/acme/n/issues/4')],
        wouldRemove: [entry('carol', 'https://github.com/acme/n/issues/3')],
      },
      { dryRun: true },
    );

    const html = core.summary.stringify();
    expect(html).toContain(
      '<tr><td>Notifications that would be created</td><td>1</td></tr>',
    );
    expect(html).toContain('<li>bob</li>');
    expect(html).toContain(
      '<li><a href="https://github.com/acme/n/issues/4">dave</a></li>',
    );
    expect(html).toContain(
      '<tr><td>Grace period expired (dry run, not removed)</td><td>1</td></tr>',
    );
  });
});
