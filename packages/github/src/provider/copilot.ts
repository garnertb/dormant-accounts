import { dormancyCheck } from 'dormant-accounts';
import type {
  FetchActivityHandler,
  LastActivityRecord,
} from 'dormant-accounts';
import { GitHubHandlerConfig, GitHubHandlerArgs } from './types';
import ms from 'ms';

const logger = console;

const fetchLatestActivityFromCoPilot: FetchActivityHandler<
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

      // @todo filter out pending_cancellation_date?
      for (const seat of seats) {
        const actor = (seat.assignee.login as string).toLowerCase();

        if (!actor) continue;

        // default date to 0 if not present
        const lastActivity = seat.last_activity_at
          ? new Date(seat.last_activity_at)
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

/**
 * Configures a dormancy check for GitHub user inactivity based on Copilot usage.
 *
 * @param config  - The configuration object for the dormancy check.
 *
 * @returns A dormancy check function configured for GitHub user inactivity.
 */
export const copilotDormancy = (config: GitHubHandlerArgs) => {
  const {
    type = 'github-copilot-dormancy',
    fetchLatestActivity = fetchLatestActivityFromCoPilot,
    ...rest
  } = config;

  return dormancyCheck<GitHubHandlerConfig>({
    type,
    ...rest,
    fetchLatestActivity,
  });
};
