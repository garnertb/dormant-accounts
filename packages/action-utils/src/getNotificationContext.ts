import * as core from '@actions/core';
import * as z from 'zod';
import { parseRepository } from './repository';

const isRepository = (value: string): boolean => {
  try {
    parseRepository(value, 'notifications-repo');
    return true;
  } catch {
    return false;
  }
};

const notificationSchema = z
  .object({
    repo: z.string().refine(isRepository, {
      message: 'Expected "owner/repo"',
    }),
    duration: z.string(),
    body: z.string(),
    baseLabels: z.array(z.string()).min(1),
    dryRun: z.boolean().optional().default(false),
    assignUserToIssue: z.boolean().optional().default(true),
    removeDormantAccounts: z.boolean().optional().default(false),
  })
  .transform(({ repo, ...rest }) => ({
    repo: parseRepository(repo, 'notifications-repo'),
    ...rest,
  }));

export type NotificationContext = z.infer<typeof notificationSchema>;

/**
 * Options for {@link getNotificationContext}
 */
export interface NotificationContextOptions {
  /** Label applied to every notification issue created by the check */
  baseLabel: string;
  /**
   * The action's global dry-run flag. When true, notifications run in dry-run
   * mode and account removal is disabled, regardless of the other inputs.
   */
  dryRun?: boolean;
}

/**
 * Retrieves the notification context from the action inputs.
 *
 * Reads `notifications-enabled`, `notifications-repo`,
 * `notifications-duration`, `notifications-body`, `notifications-dry-run`,
 * `assign-user-to-notification-issue` and `remove-dormant-accounts`.
 *
 * @param options - The base label and global dry-run flag
 * @returns The notification context, or false if notifications are disabled or the inputs are invalid
 */
export function getNotificationContext({
  baseLabel,
  dryRun = false,
}: NotificationContextOptions): NotificationContext | false {
  if (core.getInput('notifications-enabled') !== 'true') {
    core.debug('Notifications are disabled');
    return false;
  }

  const parsedNotification = notificationSchema.safeParse({
    repo: core.getInput('notifications-repo'),
    duration: core.getInput('notifications-duration'),
    body: core.getInput('notifications-body'),
    baseLabels: [baseLabel],
    dryRun: core.getBooleanInput('notifications-dry-run'),
    assignUserToIssue: core.getBooleanInput(
      'assign-user-to-notification-issue',
    ),
    removeDormantAccounts: core.getBooleanInput('remove-dormant-accounts'),
  });

  if (!parsedNotification.success) {
    core.setFailed(
      `Invalid notification inputs: ${parsedNotification.error.message}`,
    );
    return false;
  }

  if (dryRun) {
    return {
      ...parsedNotification.data,
      dryRun: true,
      removeDormantAccounts: false,
    };
  }

  return parsedNotification.data;
}
