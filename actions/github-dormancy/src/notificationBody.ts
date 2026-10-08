/**
 * Options for {@link buildDefaultNotificationBody}
 */
export interface DefaultNotificationBodyOptions {
  /** Organization being checked */
  org: string;
  /** Whether Copilot usage counts as activity */
  includeCopilotActivity: boolean;
  /** Whether comments on the notification issue count as activity */
  countNotificationComments: boolean;
  /** Whether accounts are removed once the grace period expires */
  removeDormantAccounts: boolean;
}

/**
 * Builds the default notification issue body. It lists only the activity the
 * check counts, and uses the notifier's `{{dormantAfter}}`, `{{gracePeriod}}`
 * and `{{lastActivity}}` template variables.
 *
 * @param options - The organization and the enabled activity sources
 * @returns The notification body template
 */
export function buildDefaultNotificationBody({
  org,
  includeCopilotActivity,
  countNotificationComments,
  removeDormantAccounts,
}: DefaultNotificationBodyOptions): string {
  const activities = [
    'Pushing to, cloning, or fetching an organization repository',
    'Opening, merging, or closing a pull request',
    'Submitting a pull request review or review comment',
    ...(includeCopilotActivity ? ['Using GitHub Copilot'] : []),
    ...(countNotificationComments ? ['Commenting on this issue'] : []),
  ];

  const sources = includeCopilotActivity
    ? 'the organization audit log and GitHub Copilot usage data'
    : 'the organization audit log';

  const unrecorded = countNotificationComments
    ? 'viewing pages, starring repositories, and opening or commenting on other issues'
    : 'viewing pages, starring repositories, and opening or commenting on issues';

  const outcome = removeDormantAccounts
    ? `Accounts that are still inactive after the grace period are removed from the ${org} organization.`
    : `Accounts that are still inactive after the grace period may be removed from the ${org} organization.`;

  return [
    `The ${org} organization reviews memberships that have been inactive for {{dormantAfter}}. Your account has no recorded activity in that time.`,
    '',
    '> [!NOTE]',
    '> Be active within **{{gracePeriod}}** to keep your membership. Activity that counts includes:',
    '>',
    ...activities.map((activity) => `> - ${activity}`),
    '',
    `${outcome} This issue will be automatically closed when new activity is detected or once the account is removed.`,
    '',
    '<details>',
    '<summary>I am active, why did I receive this?</summary>',
    '<br/>',
    `Activity is read from ${sources}. The audit log only covers activity in the ${org} organization and does not record everything: ${unrecorded} are not recorded.`,
    '</details>',
    '<details>',
    '<summary>When was my last activity?</summary>',
    '<br/>',
    'Last recorded activity: {{lastActivity}}',
    '</details>',
  ].join('\n');
}
