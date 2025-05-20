import { dormancyCheck } from 'dormant-accounts';
import type {
  FetchActivityHandler,
  LastActivityRecord,
  RemoveUserHandler,
} from 'dormant-accounts';
import { GitHubHandlerConfig, GitHubHandlerArgs, OctokitClient } from './types';
import ms from 'ms';

const logger = console;

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

/**
 * Remove user handler meant to be configured as part of a dormancy check.
 *
 * @param octokit - The Octokit instance for making API calls.
 * @param org - The organization to remove users from.
 * @param accounts - The list of users to remove.
 * @param dryRun - If true, only logs the actions without executing them.
 * @returns A promise true if the user was removed, false otherwise.
 *
 */
export const removeAccount: RemoveUserHandler<
  GitHubHandlerConfig,
  boolean
> = async ({ login, octokit, org, dryRun }) => {
  return revokeCopilotLicense({
    logins: login,
    octokit,
    org,
    dryRun: dryRun == true,
  });
};

/**
 * Removes a list of users from GitHub Copilot in a given organization.
 *
 * @param logins - The list of users to remove.
 * @param octokit - The Octokit instance for making API calls.
 * @param org - The organization to remove users from.
 * @param dryRun - If true, only logs the actions without executing them.
 * @returns A promise `true` if the user was removed, `false` otherwise.
 *
 */
export const revokeCopilotLicense = async (config: {
  logins: string | string[];
  octokit: OctokitClient;
  org: string;
  dryRun?: boolean;
}) => {
  const { octokit, org, logins, dryRun } = config;

  let selected_usernames = logins;

  if (typeof selected_usernames === 'string') {
    selected_usernames = [selected_usernames];
  }

  if (dryRun) {
    logger.info(`DRY RUN: Removing ${selected_usernames} from ${org}`);
  } else {
    const {
      data: { seats_cancelled },
    } = await octokit.rest.copilot.cancelCopilotSeatAssignmentForUsers({
      org,
      selected_usernames,
    });
    logger.info(`Removed ${seats_cancelled} license from ${org}`);
    return seats_cancelled === 1;
  }
  return false;
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
