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
export const fetchLatestActivityFromCopilot: FetchActivityHandler<
  GitHubHandlerConfig
> = async ({ octokit, org, checkType, logger }) => {
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
        const actor = (seat.assignee.login as string).toLowerCase();

        if (!actor) continue;

        if (seat.pending_cancellation_date) {
          logger.debug(
            checkType,
            `Skipping activity record for ${actor} due to pending cancellation`,
          );
          continue;
        }

        const lastActivity = seat.last_activity_at
          ? new Date(seat.last_activity_at)
          : seat.created_at
            ? new Date(seat.created_at)
            : null;
        const record = {
          type: seat.last_activity_editor,
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
