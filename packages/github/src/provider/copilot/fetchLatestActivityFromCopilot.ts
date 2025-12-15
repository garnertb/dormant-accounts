import type {
  FetchActivityHandler,
  LastActivityRecord,
} from 'dormant-accounts';
import { GitHubHandlerConfig } from '../types';
import ms from 'ms';

/**
 * Fetches the latest activity from GitHub Copilot for a given organization and returns the
 * users last activity or the date they were added to Copilot if no activity is found.
 *
 * @param octokit - The Octokit instance for making API calls.
 * @param org - The organization to fetch activity for.
 * @param checkType - The type of check being performed.
 * @param logger - The logger instance for logging messages.
 *
 * @returns A promise that resolves to an array of LastActivityRecord objects.
 */
/**
 * Determines the last activity date based on the configured behavior.
 *
 * @param lastActivityAt - The last_activity_at timestamp from the API
 * @param lastAuthenticatedAt - The last_authenticated_at timestamp from the API
 * @param createdAt - The created_at timestamp from the API
 * @param behavior - How to handle last_authenticated_at ('ignore', 'fallback', or 'most-recent')
 * @returns Object with the determined date and whether last_authenticated_at was used
 */
const determineLastActivity = (
  lastActivityAt: string | null | undefined,
  lastAuthenticatedAt: string | null | undefined,
  createdAt: string | null | undefined,
  behavior: 'ignore' | 'fallback' | 'most-recent' = 'ignore',
): { date: Date | null; usedAuthenticated: boolean } => {
  const activityDate = lastActivityAt ? new Date(lastActivityAt) : null;
  const authenticatedDate = lastAuthenticatedAt
    ? new Date(lastAuthenticatedAt)
    : null;
  const createdDate = createdAt ? new Date(createdAt) : null;

  switch (behavior) {
    case 'most-recent': {
      // Take the most recent of last_activity_at and last_authenticated_at
      if (activityDate && authenticatedDate) {
        if (authenticatedDate > activityDate) {
          return { date: authenticatedDate, usedAuthenticated: true };
        }
        return { date: activityDate, usedAuthenticated: false };
      }
      if (authenticatedDate) {
        return { date: authenticatedDate, usedAuthenticated: true };
      }
      if (activityDate) {
        return { date: activityDate, usedAuthenticated: false };
      }
      return { date: createdDate, usedAuthenticated: false };
    }
    case 'fallback': {
      // Use last_activity_at first, then last_authenticated_at, then created_at
      if (activityDate) {
        return { date: activityDate, usedAuthenticated: false };
      }
      if (authenticatedDate) {
        return { date: authenticatedDate, usedAuthenticated: true };
      }
      return { date: createdDate, usedAuthenticated: false };
    }
    case 'ignore':
    default: {
      // Only use last_activity_at, falling back to created_at
      return { date: activityDate ?? createdDate, usedAuthenticated: false };
    }
  }
};

export const fetchLatestActivityFromCopilot: FetchActivityHandler<
  GitHubHandlerConfig
> = async ({
  octokit,
  org,
  checkType,
  logger,
  authenticatedAtBehavior = 'ignore',
}) => {
  logger.debug(checkType, `Fetching audit log for ${org}`);

  const payload = {
    org,
    per_page: 100,
  };

  try {
    const processed: Record<string, LastActivityRecord> = {};

    const iterator = octokit.paginate.iterator(
      octokit.rest.copilot.listCopilotSeats,
      payload,
    );

    for await (const {
      data: { seats, total_seats },
    } of iterator) {
      logger.debug(
        checkType,
        `Found ${total_seats} total copilot seats in ${org} org`,
      );

      if (!seats?.length) continue;

      for (const seat of seats) {
        if (!seat.assignee?.login) {
          logger.warn(
            checkType,
            `Skipping activity record for seat with no assignee login - ${JSON.stringify(seat, undefined, 2)}`,
          );
          continue;
        }

        const actor = (seat.assignee.login as string).toLowerCase();

        if (!actor) continue;

        if (seat.pending_cancellation_date) {
          logger.debug(
            checkType,
            `Skipping activity record for ${actor} due to pending cancellation`,
          );
          continue;
        }

        const lastAuthenticatedAt = (
          seat as { last_authenticated_at?: string | null }
        ).last_authenticated_at;

        if (
          !seat.last_activity_at &&
          lastAuthenticatedAt !== null &&
          authenticatedAtBehavior !== 'ignore'
        ) {
          const behaviorMessage =
            authenticatedAtBehavior === 'most-recent'
              ? ', using most recent of activity/authenticated times'
              : authenticatedAtBehavior === 'fallback'
                ? ', using authenticated_at as fallback'
                : '';
          logger.debug(
            checkType,
            `No activity found for ${actor}${behaviorMessage}`,
          );
        }

        const { date: lastActivity, usedAuthenticated } = determineLastActivity(
          seat.last_activity_at,
          lastAuthenticatedAt,
          seat.created_at,
          authenticatedAtBehavior,
        );
        const record = {
          type: usedAuthenticated
            ? 'last_authentication'
            : seat.last_activity_editor,
          login: actor,
          lastActivity: lastActivity,
        };

        if (
          !processed[actor]?.lastActivity ||
          (lastActivity && lastActivity > processed[actor].lastActivity)
        ) {
          // @ts-expect-error
          processed[actor] = record;
          const log = lastActivity
            ? `${ms(Date.now() - lastActivity.getTime())} ago`
            : 'never';
          logger.debug(
            `Activity record found for ${actor} - ${log}${record.type ? ` - ${record.type}` : ''}`,
          );
        }
      }
    }
    return Object.values(processed);
  } catch (error) {
    logger.error(checkType, 'Failed to fetch audit log', { error });
    throw error;
  }
};
