import { logger } from './utils';
import {
  DormancyCheckConfig,
  LastActivityRecord,
  PassedDormancyCheckConfiguration,
  DurationString,
  IsDormantHandler,
  DormantAccountCheckSummary,
  DormantAccountStatusMap,
  Activity,
  ActivityMergeStrategy,
} from './types';
import type { SetRequired } from 'type-fest';
import { Database } from './database';
import { durationToMillis, compareDatesAgainstDuration } from './utils';
import { mergeActivityRecords } from './merge';

export type * from './types';
export {
  FIRST_SEEN_ACTIVITY_TYPE,
  dedupeActivityRecords,
  mergeActivityRecords,
  pickLatestRecord,
  type FirstSeenOptions,
  type MergeActivityOptions,
  type MergeActivityResult,
} from './merge';

/**
 * Handles checking and managing user dormancy status based on configured rules
 * @template TConfig - Type for extended configuration options
 */
export class DormantAccountCheck<TConfig> {
  private readonly db: Database;
  private readonly config: DormancyCheckConfig<TConfig>;
  private isDormant: IsDormantHandler<TConfig>;
  private duration: DurationString;
  private dryRun: boolean;
  private durationMillis?: number;
  private readonly activityResultType: 'partial' | 'complete';
  private readonly activityMergeStrategy: ActivityMergeStrategy;
  private readonly firstSeenBaseline: boolean;
  readonly type: string;

  constructor(
    config: SetRequired<DormancyCheckConfig<TConfig>, 'fetchLatestActivity'>,
  ) {
    this.config = config;
    logger.debug('DormantAccountCheck initialized with config:', this.config);
    this.type = config.type;
    this.activityResultType = config.activityResultType || 'partial';
    this.activityMergeStrategy = config.activityMergeStrategy ?? 'replace';
    this.firstSeenBaseline = config.firstSeenBaseline === true;

    if (this.activityMergeStrategy === 'latest' && config.logActivityForUser) {
      throw new Error(
        "activityMergeStrategy 'latest' cannot be combined with a custom logActivityForUser",
      );
    }

    if (
      this.firstSeenBaseline &&
      (this.activityResultType !== 'complete' ||
        this.activityMergeStrategy !== 'latest')
    ) {
      throw new Error(
        "firstSeenBaseline requires activityResultType 'complete' and activityMergeStrategy 'latest'",
      );
    }

    this.db = new Database(this.type, this.config.dbPath);
    this.dryRun = this.config.dryRun === true;
    this.duration = (this.config.duration as DurationString) || '30d';
    this.durationMillis = durationToMillis(this.duration);
    this.isDormant = this.config.isDormant
      ? this.config.isDormant
      : this.defaultDormancyHandler;
  }

  private defaultDormancyHandler: IsDormantHandler<TConfig> = async ({
    checkTime,
    login,
    lastActivity,
    duration,
    logger,
  }) => {
    if (!lastActivity) {
      logger.warn(`User ${login} has no activity, considered dormant`);
      return true;
    }

    if (!duration) {
      throw new Error('No duration provided for dormancy check');
    }

    const { overDuration: isDormant, actualDurationString } =
      compareDatesAgainstDuration(duration, lastActivity, checkTime);

    logger.trace(
      `User ${login} last activity was ${actualDurationString} which is ${isDormant ? 'greater' : 'less'} than maximum duration ${duration}`,
    );

    return isDormant;
  };

  /**
   * Consola logger instance for logging messages
   */
  private get logger() {
    return logger.withTag(this.type);
  }

  /**
   * Builds a context object combining activity record with extended configuration
   * @param record - The activity record to extend
   * @returns Combined context with activity record and extended configuration
   */
  private buildHandlerContext(
    record: LastActivityRecord,
  ): LastActivityRecord & TConfig & PassedDormancyCheckConfiguration<TConfig> {
    return {
      ...record,
      ...this.config.conf,
      checkType: this.type,
      dryRun: this.dryRun,
      duration: this.duration,
      durationMillis: this.durationMillis,
      logger: this.logger,
    } as LastActivityRecord &
      TConfig &
      PassedDormancyCheckConfiguration<TConfig>;
  }

  /**
   * Logs activity for a specific user using configured method or default database update
   * @param param0 - Object containing the last activity record
   */
  private async logActivityForUser({
    lastActivityRecord,
  }: {
    lastActivityRecord: LastActivityRecord;
  }): Promise<void> {
    if (!this.config.logActivityForUser) {
      this.logger.trace(
        `Updating user activity for ${lastActivityRecord.login} using default method`,
      );
      return this.db.updateUserActivity({ lastActivityRecord });
    }

    this.logger.trace(
      `Updating user activity for ${lastActivityRecord.login} using custom method`,
    );
    return this.config.logActivityForUser(
      this.buildHandlerContext(lastActivityRecord),
    );
  }

  /**
   * Fetches and updates activity records for all users since the last fetch time
   * @param lastFetchTime - Optional timestamp to fetch activities since
   */
  async fetchActivity(lastFetchTime?: Date): Promise<void> {
    const fetchStartTime = new Date();
    const lastRun = lastFetchTime || (await this.db.getLastRun());

    this.logger.start(`Fetching and logging latest activity`);
    this.logger.start(`Fetching latest activity`);

    try {
      const entries = await this.config.fetchLatestActivity({
        lastFetchTime: lastRun,
        ...(this.config.conf as TConfig),
        checkType: this.type,
        dryRun: this.dryRun,
        logger: this.logger,
      });

      this.logger.success(`Fetched ${entries.length} activity records`);

      if (this.activityMergeStrategy === 'latest') {
        await this.mergeLatestActivity(entries, fetchStartTime);
      } else {
        await this.replaceActivity(entries);
        await this.db.updateLastRun(fetchStartTime);
      }

      this.logger.success(`Completed fetching and logging latest activity`);
    } catch (error) {
      logger.error('Failed fetching and logging latest activity', error);
      throw error;
    }
  }

  /**
   * Merges fetched activity with the `latest` strategy and persists records,
   * complete-mode pruning and run state in a single database write
   * @param entries - Activity records returned by the fetcher
   * @param fetchStartTime - Time the fetch started, stored as the last run
   */
  private async mergeLatestActivity(
    entries: LastActivityRecord[],
    fetchStartTime: Date,
  ): Promise<void> {
    this.logger.start(`Merging latest activity`);

    const stored = await this.listAccounts();
    const rosterInitializedAt = this.firstSeenBaseline
      ? await this.db.getRosterInitializedAt()
      : null;
    const establishesBaseline = this.firstSeenBaseline && !rosterInitializedAt;

    const { records, pruned, firstSeen } = mergeActivityRecords({
      stored,
      incoming: entries,
      prune: this.activityResultType === 'complete',
      firstSeen: this.firstSeenBaseline
        ? {
            rosterInitialized: rosterInitializedAt !== null,
            timestamp: fetchStartTime,
          }
        : undefined,
    });

    if (pruned.length > 0) {
      this.logger.info(
        `Pruning ${pruned.length} accounts no longer in the system${this.dryRun ? ' (working copy only in dry run)' : ''}`,
      );
    }

    if (firstSeen.length > 0) {
      this.logger.info(
        `Stamped ${firstSeen.length} newly seen accounts with first-seen activity`,
      );
    }

    if (establishesBaseline) {
      this.logger.info('Establishing first-seen roster baseline');
    }

    await this.db.replaceActivityRecords({
      records,
      lastRun: fetchStartTime,
      rosterInitializedAt: establishesBaseline ? fetchStartTime : undefined,
    });

    this.logger.success(`Merged ${records.length} activity records`);
  }

  /**
   * Logs fetched activity with the `replace` strategy and, for complete results,
   * removes accounts missing from the snapshot. In dry run the removal still applies
   * to the local working copy so dry-run counts match a real run.
   * @param entries - Activity records returned by the fetcher
   */
  private async replaceActivity(entries: LastActivityRecord[]): Promise<void> {
    this.logger.start(`Logging latest activity`);

    await Promise.all(
      entries.map((entry) =>
        this.logActivityForUser({ lastActivityRecord: entry }),
      ),
    );

    this.logger.success(`Finished logging latest activity`);

    // If activityResultType is 'complete', the activity represents a complete
    // snapshot of all users in the system, so we need to remove any users
    // that are no longer present in the snapshot
    if (this.activityResultType !== 'complete') {
      return;
    }

    this.logger.start('Processing complete activity results');

    const allUsers = await this.listAccounts();
    const fetchedUserLoginsSet = new Set(entries.map((entry) => entry.login));
    const usersToRemove = allUsers.filter(
      (user) => !fetchedUserLoginsSet.has(user.login),
    );

    if (usersToRemove.length === 0) {
      this.logger.info(
        'No accounts to remove based on complete activity results',
      );
      return;
    }

    this.logger.info(
      `Found ${usersToRemove.length} accounts no longer in the system`,
    );

    if (this.dryRun) {
      this.logger.info(
        '[DRY RUN] Removing accounts from the local working copy only',
      );
    }

    for (const user of usersToRemove) {
      this.logger.info(
        `Removing user ${user.login} as they are no longer in the system`,
      );
      await this.activity.remove(user);
    }

    this.logger.success(
      `Removed ${usersToRemove.length} accounts no longer in the system`,
    );
  }

  /**
   * Retrieves the whitelist status for a user
   * @param record - The activity record to check
   * @returns Promise<boolean> true if user should be whitelisted
   */
  private async checkWhitelist(record: LastActivityRecord): Promise<boolean> {
    if (this.config.isWhitelisted) {
      return this.config.isWhitelisted(this.buildHandlerContext(record));
    }

    return Promise.resolve(false);
  }

  /**
   * Categorizes all accounts into active and dormant status groups
   * @returns Object containing arrays of active and dormant user records
   * @throws Error when dormancy checking is not configured
   */
  private async getAccountStatuses(): Promise<DormantAccountStatusMap> {
    const accounts = await this.listAccounts();
    const result: DormantAccountStatusMap = {
      active: [],
      dormant: [],
    };

    // Use consistent check time for comparing activity
    const checkTime = new Date();

    await Promise.all(
      accounts.map(async (record) => {
        const isWhitelisted = await this.checkWhitelist(record);
        if (isWhitelisted) {
          result.active.push(record);
          return;
        }

        const isDormant = await this.isDormant({
          ...this.buildHandlerContext(record),
          checkTime,
        });

        if (isDormant) {
          result.dormant.push(record);
        } else {
          result.active.push(record);
        }
      }),
    );

    result.active.sort((a, b) => a.login.localeCompare(b.login));
    result.dormant.sort((a, b) => a.login.localeCompare(b.login));

    return result;
  }

  /**
   * Lists all accounts in the database
   * @returns Array of all activity records
   */
  async listAccounts(): Promise<LastActivityRecord[]> {
    return this.db.getActivityRecords();
  }

  /**
   * Lists all active accounts based on the configured inactivity threshold
   * @returns Array of active user activity records
   */
  async listActiveAccounts(): Promise<LastActivityRecord[]> {
    const { active } = await this.getAccountStatuses();
    return active;
  }

  /**
   * Lists all dormant accounts based on the configured inactivity threshold
   * @returns Array of dormant user activity records
   */
  async listDormantAccounts(): Promise<LastActivityRecord[]> {
    const { dormant } = await this.getAccountStatuses();
    return dormant;
  }

  /**
   * Generates a comprehensive summary of account activity statistics
   * @returns Summary object containing activity statistics and metrics
   */
  async summarize(): Promise<DormantAccountCheckSummary> {
    const { active, dormant } = await this.getAccountStatuses();
    const totalAccounts = active.length + dormant.length;

    return {
      lastActivityFetch: (await this.db.getLastRun()).toISOString(),
      totalAccounts,
      activeAccounts: active.length,
      dormantAccounts: dormant.length,
      activeAccountPercentage:
        totalAccounts > 0
          ? parseFloat(((active.length / totalAccounts) * 100).toFixed(2))
          : 0,
      dormantAccountPercentage:
        totalAccounts > 0
          ? parseFloat(((dormant.length / totalAccounts) * 100).toFixed(2))
          : 0,
      duration: this.duration,
    };
  }

  /**
   * Provides access to the activity database for raw data retrieval and user removal
   * @returns interface with methods to interact with the activity database
   */
  get activity(): Activity {
    return {
      all: async () => this.db.getRawData(),
      remove: async (user: LastActivityRecord | string) => {
        const userLogin = typeof user === 'string' ? user : user.login;
        const result = await this.db.removeUserActivityRecord(user);

        if (result) {
          this.logger.success(`Removed user ${userLogin} from database`);
        } else {
          this.logger.warn(`User ${userLogin} not found in database`);
        }
        return result;
      },
    };
  }

  /**
   * Gets the raw database data
   * @returns The raw database content
   */
  public async getDatabaseData(): Promise<unknown> {
    return this.db.getRawData();
  }
}

/**
 * Creates a new dormancy checker instance with the provided configuration
 * @template T - Type for extended configuration options
 * @param config - Configuration for dormancy checking
 * @returns A configured DormancyChecker instance
 */
export function dormancyCheck<CheckType>(
  config: DormancyCheckConfig<CheckType>,
): DormantAccountCheck<CheckType> {
  return new DormantAccountCheck(config);
}
