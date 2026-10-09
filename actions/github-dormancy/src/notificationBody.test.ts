import { describe, expect, it } from 'vitest';
import { buildDefaultNotificationBody } from './notificationBody';

const OPTIONS = {
  org: 'acme',
  includeCopilotActivity: false,
  countNotificationComments: false,
  removeDormantAccounts: false,
};

const activityList = (body: string) =>
  body
    .split('\n')
    .filter((line) => line.startsWith('> - '))
    .map((line) => line.slice(4));

describe('buildDefaultNotificationBody', () => {
  it('lists audit log activity and says accounts may be removed by default', () => {
    const body = buildDefaultNotificationBody(OPTIONS);

    expect(body).toMatch(
      /^The acme organization reviews memberships that have been inactive for \{\{dormantAfter\}\}\./,
    );
    expect(activityList(body)).toEqual([
      'Pushing to, cloning, or fetching an organization repository',
      'Opening, merging, or closing a pull request',
      'Submitting a pull request review or review comment',
    ]);
    expect(body).toContain(
      'may be removed from the acme organization. This issue will be automatically closed',
    );
    expect(body).toContain(
      'Activity is read from the organization audit log. The audit log only covers activity in the acme organization',
    );
    expect(body).toContain('opening or commenting on issues are not recorded');
    expect(body).toContain('Be active within **{{gracePeriod}}**');
    expect(body).toContain('Last recorded activity: {{lastActivity}}');
    expect(body).not.toMatch(/copilot/i);
  });

  it('lists Copilot usage when it counts as activity', () => {
    const body = buildDefaultNotificationBody({
      ...OPTIONS,
      includeCopilotActivity: true,
    });

    expect(activityList(body)).toContain('Using GitHub Copilot');
    expect(body).toContain(
      'Activity is read from the organization audit log and GitHub Copilot usage data.',
    );
  });

  it('lists comments on the notification when they count as activity', () => {
    const body = buildDefaultNotificationBody({
      ...OPTIONS,
      countNotificationComments: true,
    });

    expect(activityList(body)).toContain('Commenting on this issue');
    expect(body).toContain(
      'opening or commenting on other issues are not recorded',
    );
  });

  it('says accounts are removed when removal is enabled', () => {
    const body = buildDefaultNotificationBody({
      ...OPTIONS,
      removeDormantAccounts: true,
    });

    expect(body).toContain(
      'Accounts that are still inactive after the grace period are removed from the acme organization.',
    );
    expect(body).not.toContain('may be removed');
  });
});
