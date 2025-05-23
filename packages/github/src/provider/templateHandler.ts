import { EnrichedLastActivityRecord } from 'dormant-accounts/utils';

/**
 * Context object for notification template handlers
 */
export interface NotificationHandlerContext {
  /** Enriched activity record containing user information */
  readonly lastActivityRecord: EnrichedLastActivityRecord;
  /** Grace period before account removal (formatted string) */
  readonly gracePeriod: string;
  /** Optional duration after which account is considered dormant */
  readonly dormantAfter?: string;
}

/**
 * Function type that generates notification body text based on user information
 */
export type NotificationBodyHandler = (
  context: NotificationHandlerContext,
) => string;

/**
 * Creates a handler for generating notification bodies.
 * @param notificationTemplate - Template string for the notification body
 * @returns handler function that receives a context object and returns the formatted notification body
 *
 * The template string can include placeholders for user information:
 * - `{{account}}`: The account identification
 * - `{{dormantAfter}}`: The inactivity period, after which the account is considered dormant
 * - `{{lastActivity}}`: The last activity date (localized)
 * - `{{gracePeriod}}`: The grace period for reactivation
 * - `{{timeSinceLastActivity}}`: The time since the last activity
 *
 * @example
 * ```ts
 * const handler = createDefaultNotificationBodyHandler(
 *  'Hello {{account}}, your last activity was on {{lastActivity}}. ' +
 *  'You have {{gracePeriod}} to reactivate your account. ' +
 *  'Time since last activity: {{timeSinceLastActivity}}'
 * );
 * ```
 */
export function createDefaultNotificationBodyHandler(
  notificationTemplate: string,
): NotificationBodyHandler {
  return ({
    lastActivityRecord: { login, lastActivityLocalized, humanFriendlyDuration },
    gracePeriod,
    dormantAfter,
  }): string => {
    // Use regex with global flag to replace all occurrences
    let body = notificationTemplate
      .replace(/{{lastActivity}}/g, lastActivityLocalized || 'None')
      .replace(/{{gracePeriod}}/g, gracePeriod)
      .replace(/{{timeSinceLastActivity}}/g, humanFriendlyDuration || 'N/A')
      .replace(/{{account}}/g, login);

    if (dormantAfter) {
      body = body.replace(/{{dormantAfter}}/g, dormantAfter);
    }

    return body;
  };
}
