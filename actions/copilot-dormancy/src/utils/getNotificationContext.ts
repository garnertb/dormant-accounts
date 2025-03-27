import * as core from '@actions/core';
import * as z from 'zod';

const notificationSchema = z
  .object({
    repo: z.string().includes('/'),
    duration: z.string(),
    body: z.string(),
    baseLabels: z.array(z.string()).default(['copilot-dormancy']),
    dryRun: z.boolean().optional().default(false),
    assignUserToIssue: z.boolean().optional().default(true),
    removeDormantAccounts: z.boolean().optional().default(false),
  })
  .transform((data) => {
    const { repo: ownerAndRepo, ...rest } = data;
    const [owner, repo] = ownerAndRepo.split('/');
    return {
      repo: {
        owner: owner as string,
        repo: repo as string,
      },
      ...rest,
    };
  });

export type NotificationContext = z.infer<typeof notificationSchema>;

/**
 * Retrieves the notification context from the action inputs.
 * @returns An object containing the notification context or false if notifications are disabled
 */
export function getNotificationContext(): NotificationContext | false {
  if (core.getInput('notifications-enabled') !== 'true') {
    core.debug('Notifications are disabled');
    return false;
  }

  const parsedNotification = notificationSchema.safeParse({
    repo: core.getInput('notifications-repo'),
    duration: core.getInput('notifications-duration'),
    body: core.getInput('notifications-body'),
    dryRun: core.getInput('notifications-dry-run') === 'true',
    assignUserToIssue:
      core.getInput('notifications-disable-issue-assignment') !== 'true',
    removeDormantAccounts: core.getInput('remove-dormant-accounts') === 'true',
  });

  if (!parsedNotification.success) {
    core.setFailed(
      `Invalid notification inputs: ${parsedNotification.error.message}`,
    );
    return false;
  }

  return parsedNotification.data;
}
