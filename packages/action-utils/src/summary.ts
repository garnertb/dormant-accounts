import * as core from '@actions/core';
import type { ProcessingResult } from '@dormant-accounts/github';
import type { DormantAccountCheckSummary } from 'dormant-accounts';

type NotificationEntry = ProcessingResult['notified'][number];

/**
 * Serializes data for an action output without throwing.
 *
 * @param data - The value to serialize
 * @returns The JSON string, or a JSON error object if serialization fails
 */
export const safeStringify = (data: unknown): string => {
  try {
    return JSON.stringify(data);
  } catch (error) {
    return JSON.stringify({
      error: 'Failed to stringify data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Formats an ISO timestamp for the job summary.
 *
 * @param isoString - The ISO timestamp
 * @returns The formatted date, or the input when it cannot be formatted
 */
export const formatDate = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
};

/**
 * Options for {@link addCheckSummary}
 */
export interface CheckSummaryOptions {
  /** Top-level heading for the job summary */
  heading: string;
  /** Statistics from the dormancy check */
  summary: DormantAccountCheckSummary;
  /** Whether notifications are enabled */
  notificationsEnabled: boolean;
}

/**
 * Adds the account status statistics to the job summary.
 *
 * @param options - The heading, check statistics and notification state
 */
export function addCheckSummary({
  heading,
  summary,
  notificationsEnabled,
}: CheckSummaryOptions): void {
  core.summary
    .addHeading(heading)
    .addRaw(
      `**Last Activity Fetch:** ${formatDate(summary.lastActivityFetch)}`,
      true,
    )
    .addRaw(`**Dormancy Threshold:** ${summary.duration}`, true)
    .addBreak()
    .addHeading('Account Status Summary', 3)
    .addTable([
      [
        { data: 'Account Type', header: true },
        { data: 'Count', header: true },
        { data: 'Percentage', header: true },
      ],
      [
        'Active Accounts',
        summary.activeAccounts.toString(),
        `${summary.activeAccountPercentage.toFixed(1)}%`,
      ],
      [
        'Dormant Accounts',
        summary.dormantAccounts.toString(),
        `${summary.dormantAccountPercentage.toFixed(1)}%`,
      ],
      ['Total Accounts', summary.totalAccounts.toString(), '100%'],
    ]);

  if (summary.dormantAccounts === 0) {
    return;
  }

  core.summary
    .addHeading('Dormant Accounts', 3)
    .addRaw(
      `${summary.dormantAccounts} accounts have been inactive for at least ${summary.duration}.`,
      true,
    )
    .addEOL()
    .addRaw(
      notificationsEnabled
        ? 'Notifications are being sent to these accounts.'
        : 'No notifications are being sent (notifications disabled).',
      true,
    );
}

/**
 * Options for {@link addNotificationResultsSummary}
 */
export interface NotificationResultsSummaryOptions {
  /** Whether the notifier ran in dry-run mode */
  dryRun: boolean;
}

interface ResultCategory {
  entries: NotificationEntry[];
  label: string;
  heading: string;
}

const resultCategories = (
  results: ProcessingResult,
  dryRun: boolean,
): ResultCategory[] => [
  {
    entries: results.notified,
    label: dryRun
      ? 'Notifications that would be created'
      : 'New notifications created',
    heading: dryRun
      ? 'Notifications That Would Be Created'
      : 'Newly Created Notifications',
  },
  {
    entries: results.reactivated,
    label: dryRun
      ? 'Notifications that would be closed (reactivated users)'
      : 'Notifications closed (reactivated users)',
    heading: 'Closed Notifications (Users Became Active)',
  },
  {
    entries: results.departed,
    label: dryRun
      ? 'Notifications that would be closed (departed users)'
      : 'Notifications closed (departed users)',
    heading: 'Closed Notifications (Users Departed)',
  },
  {
    entries: results.removed,
    label: 'Users removed after grace period',
    heading: 'Users Removed (Grace Period Expired)',
  },
  {
    entries: results.wouldRemove,
    label: 'Grace period expired (dry run, not removed)',
    heading: 'Grace Period Expired (Dry Run)',
  },
  {
    entries: results.skipped,
    label: 'Grace period expired, removal skipped',
    heading: 'Removal Skipped (Notification Left Open)',
  },
  {
    entries: results.excluded,
    label: 'Users with admin exclusions',
    heading: 'Admin Exclusions',
  },
  {
    entries: results.inGracePeriod,
    label: 'Users in grace period',
    heading: 'Users in Grace Period',
  },
];

const issueLink = ({ notification }: NotificationEntry): string =>
  notification.html_url
    ? `<a href="${notification.html_url}">${notification.title}</a>`
    : notification.title;

/**
 * Adds notification results to the job summary.
 *
 * @param results - The notifier's processing result
 * @param options - Whether the notifier ran in dry-run mode
 */
export function addNotificationResultsSummary(
  results: ProcessingResult,
  { dryRun }: NotificationResultsSummaryOptions,
): void {
  const categories = resultCategories(results, dryRun);

  core.summary.addHeading('Notification Results', 3).addTable([
    [
      { data: 'Action', header: true },
      { data: 'Count', header: true },
    ],
    ...categories.map(({ label, entries }) => [
      label,
      entries.length.toString(),
    ]),
    ['Errors encountered', results.errors.length.toString()],
  ]);

  for (const { heading, entries } of categories) {
    if (entries.length === 0) {
      continue;
    }

    core.summary
      .addHeading(heading, 4)
      .addList(entries.map(issueLink))
      .addEOL();
  }

  if (results.errors.length > 0) {
    core.summary
      .addHeading('Notification Errors', 4)
      .addRaw(
        'The following errors occurred during notification processing:',
        true,
      );

    results.errors.forEach(({ user, error }, index) => {
      core.summary.addRaw(
        `${index + 1}. **${user}**: ${error.message}  `,
        true,
      );
    });
  }
}

/**
 * Logs a one-line count for each notification result category.
 *
 * @param results - The notifier's processing result
 * @param options - Whether the notifier ran in dry-run mode
 */
export function logNotificationResults(
  results: ProcessingResult,
  { dryRun }: NotificationResultsSummaryOptions,
): void {
  for (const { label, entries } of resultCategories(results, dryRun)) {
    core.info(`${label}: ${entries.length}`);
  }
  core.info(`Errors encountered: ${results.errors.length}`);
}
