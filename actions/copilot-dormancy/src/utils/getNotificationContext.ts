import * as core from '@actions/core';
import * as z from 'zod';

const notificationSchema = z
  .object({
    repo: z.string().includes('/'),
    duration: z.string(),
    body: z.string(),
  })
  .transform((data) => {
    const [owner, repo] = data.repo.split('/');
    return {
      repo: {
        owner: owner as string,
        repo: repo as string,
      },
      duration: data.duration,
      body: data.body,
    };
  });

/**
 * Retrieves the notification context from the action inputs.
 * @returns An object containing the notification context or false if notifications are disabled
 */
export function getNotificationContext():
  | { repo: { owner: string; repo: string }; duration: string; body: string }
  | false {
  if (!core.getInput('notifications-enabled')) {
    return false;
  }

  const notificationRepo = core.getInput('notifications-repo');
  const notificationDuration = core.getInput('notifications-duration');
  const notificationBody = core.getInput('notifications-body');

  // Validate the notification inputs
  const parsedNotification = notificationSchema.safeParse({
    repo: notificationRepo,
    duration: notificationDuration,
    body: notificationBody,
  });

  if (!parsedNotification.success) {
    core.setFailed(
      `Invalid notification inputs: ${parsedNotification.error.message}`,
    );
    return false;
  }

  return parsedNotification.data;
}
