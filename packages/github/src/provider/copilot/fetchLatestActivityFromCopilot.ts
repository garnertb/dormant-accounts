import type {
  FetchActivityHandler,
  LastActivityRecord,
} from 'dormant-accounts';
import type { logger as dormancyLogger } from 'dormant-accounts/utils';
import type { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';
import {
  AuthenticatedAtBehavior,
  GitHubHandlerConfig,
  OctokitClient,
} from '../types';
import ms from 'ms';

/**
 * Determines the last activity date based on the configured behavior.
 *
 * @param lastActivityAt - The last_activity_at timestamp from the API
 * @param lastAuthenticatedAt - The last_authenticated_at timestamp from the API
 * @param createdAt - The created_at timestamp to fall back to, or null for no fallback
 * @param behavior - How to handle last_authenticated_at ('ignore', 'fallback', or 'most-recent')
 * @returns Object with the determined date and whether last_authenticated_at was used
 */
const determineLastActivity = (
  lastActivityAt: string | null | undefined,
  lastAuthenticatedAt: string | null | undefined,
  createdAt: string | null | undefined,
  behavior: AuthenticatedAtBehavior = 'ignore',
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

/**
 * A seat returned by the Copilot seat listing API
 */
export type CopilotSeat = NonNullable<
  GetResponseDataTypeFromEndpointMethod<
    OctokitClient['rest']['copilot']['listCopilotSeats']
  >['seats']
>[number];

/**
 * Options for mapping a Copilot seat to an activity record
 */
export interface CopilotSeatActivityOptions {
  /**
   * How `last_authenticated_at` is used
   * @default 'ignore'
   */
  authenticatedAtBehavior?: AuthenticatedAtBehavior;
  /**
   * Use the seat's `created_at`, when it was last assigned, if it has no
   * activity date. When false, such a seat's record has a `null` date.
   * @default true
   */
  fallbackToCreatedAt?: boolean;
}

/**
 * Maps a Copilot seat to an activity record without filtering pending
 * cancellations.
 *
 * @param seat - Seat returned by the Copilot seat listing API
 * @param options - How the activity date is chosen
 * @returns The activity record keyed by lowercase login, or null when the seat
 * has no assignee login
 */
export const copilotSeatToActivityRecord = (
  seat: CopilotSeat,
  {
    authenticatedAtBehavior = 'ignore',
    fallbackToCreatedAt = true,
  }: CopilotSeatActivityOptions = {},
): LastActivityRecord | null => {
  const login = (
    seat.assignee as { login?: string } | null | undefined
  )?.login?.toLowerCase();

  if (!login) {
    return null;
  }

  const lastAuthenticatedAt = (
    seat as { last_authenticated_at?: string | null }
  ).last_authenticated_at;

  const { date, usedAuthenticated } = determineLastActivity(
    seat.last_activity_at,
    lastAuthenticatedAt,
    fallbackToCreatedAt ? seat.created_at : null,
    authenticatedAtBehavior,
  );

  return {
    type: usedAuthenticated ? 'last_authentication' : seat.last_activity_editor,
    login,
    lastActivity: date,
  } as LastActivityRecord;
};

/**
 * Options for {@link fetchCopilotSeatActivity}
 */
export interface FetchCopilotSeatActivityOptions
  extends CopilotSeatActivityOptions {
  octokit: OctokitClient;
  org: string;
  logger: typeof dormancyLogger;
  checkType?: string;
  /**
   * Include seats that are pending cancellation
   * @default false
   */
  includePendingCancellation?: boolean;
}

/**
 * Lists every Copilot seat in an organization and returns the latest activity
 * record per assignee.
 *
 * @param options - Fetch options
 * @returns One activity record per seat assignee
 */
export const fetchCopilotSeatActivity = async ({
  octokit,
  org,
  logger,
  checkType = 'copilot',
  authenticatedAtBehavior = 'ignore',
  fallbackToCreatedAt = true,
  includePendingCancellation = false,
}: FetchCopilotSeatActivityOptions): Promise<LastActivityRecord[]> => {
  logger.debug(checkType, `Fetching Copilot seats for ${org}`);

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
        const record = copilotSeatToActivityRecord(seat, {
          authenticatedAtBehavior,
          fallbackToCreatedAt,
        });

        if (!record) {
          logger.warn(
            checkType,
            `Skipping activity record for seat with no assignee login - ${JSON.stringify(seat, undefined, 2)}`,
          );
          continue;
        }

        const actor = record.login;

        if (seat.pending_cancellation_date && !includePendingCancellation) {
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

        const { lastActivity } = record;

        if (
          !processed[actor]?.lastActivity ||
          (lastActivity && lastActivity > processed[actor].lastActivity)
        ) {
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
    logger.error(checkType, 'Failed to fetch Copilot seats', { error });
    throw error;
  }
};

/**
 * Fetches the latest activity from GitHub Copilot for a given organization and
 * returns each user's last activity, or the date they were added to Copilot if
 * no activity is found. Seats pending cancellation are skipped.
 *
 * @param octokit - The Octokit instance for making API calls.
 * @param org - The organization to fetch activity for.
 * @param checkType - The type of check being performed.
 * @param logger - The logger instance for logging messages.
 *
 * @returns A promise that resolves to an array of LastActivityRecord objects.
 */
export const fetchLatestActivityFromCopilot: FetchActivityHandler<
  GitHubHandlerConfig
> = async ({
  octokit,
  org,
  checkType,
  logger,
  authenticatedAtBehavior = 'ignore',
}) =>
  fetchCopilotSeatActivity({
    octokit,
    org,
    checkType,
    logger,
    authenticatedAtBehavior,
    includePendingCancellation: false,
  });
