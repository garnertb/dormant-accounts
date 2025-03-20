import { dormancyCheck } from 'dormant-accounts';
import type {
  FetchActivityHandler,
  LastActivityRecord,
} from 'dormant-accounts';
import { GitHubHandlerConfig, GitHubHandlerArgs } from './types';
import ms from 'ms';

export type AuditLogRecord = {
  '@timestamp': string;
  action: string;
  actor: string;
};

const fetchAuditLogActivity: FetchActivityHandler<
  GitHubHandlerConfig
> = async ({ lastFetchTime, octokit, org, logger }) => {
  const lastFetchTimeAsDate = new Date(lastFetchTime);

  const payload = {
    org,
    include: 'all',
    phrase: `created:>=${lastFetchTimeAsDate.toISOString()}`,
    per_page: 100,
    order: 'desc',
  };

  logger.debug(`Fetching audit log for ${org} since ${lastFetchTimeAsDate}`);

  try {
    const processed: Record<string, LastActivityRecord> = {};

    try {
      for await (const {
        data: entries,
      } of octokit.paginate.iterator<AuditLogRecord>(
        'GET /orgs/{org}/audit-log',
        payload,
      )) {
        for (const entry of entries) {
          if (!entry.actor) continue;

          const actor = entry.actor.toLowerCase();
          const lastActivity = entry['@timestamp']
            ? new Date(entry['@timestamp'])
            : null;
          const record = { type: entry.action, login: actor, lastActivity };

          if (
            !processed[actor]?.lastActivity ||
            (lastActivity && lastActivity > processed[actor].lastActivity)
          ) {
            processed[actor] = record;
            const log = lastActivity
              ? `${ms(Date.now() - lastActivity.getTime())} ago`
              : 'unknown';
            logger.debug(
              `Activity record found for ${actor} - ${log}${record.type ? ` - ${record.type}` : ''}`,
            );
          }
        }
      }
    } catch (err: any) {
      if (err.status === 404) {
        logger.error(
          `Audit log not found for organization ${org}. The organization may not have audit log access.`,
        );
        return [];
      }
      throw err;
    }

    return Object.values(processed);
  } catch (error) {
    logger.error('Failed to fetch audit log', { error });
    throw error;
  }
};

/**
 * Creates a GitHub dormancy check, which analyzes the audit log to determine user inactivity.
 *
 * @param config - The configuration object for the dormancy check.
 * @param config - The extended configuration specific to GitHub handler.
 *
 * @returns A dormancy check function configured for GitHub user inactivity.
 */
export const githubDormancy = (config: GitHubHandlerArgs) => {
  const {
    type = 'github-dormancy',
    fetchLatestActivity = fetchAuditLogActivity,
    ...rest
  } = config;

  return dormancyCheck<GitHubHandlerConfig>({
    type,
    ...rest,
    fetchLatestActivity,
  });
};
