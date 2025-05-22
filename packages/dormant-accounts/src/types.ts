import { z } from 'zod';
import { StringValue } from 'ms';
import { RequireAllOrNone } from 'type-fest';
import { logger } from './utils';

/**
 * Schema for validating activity records
 * Ensures required fields are present and of correct type
 */
export const LastActivityRecordSchema = z.object({
  login: z
    .string({
      required_error: 'Username is required',
      invalid_type_error: 'Username must be a string',
    })
    .min(1, 'Username cannot be empty'),

  lastActivity: z.date().nullable().describe('Last updated date'),
  type: z
    .string({
      required_error: 'Activity type is required',
    })
    .min(1, 'Activity type cannot be empty'),

  metadata: z.record(z.unknown()).optional(),
});

export type DurationString = StringValue | string;

/**
 * Represents a user's last recorded activity
 */
export type LastActivityRecord = {
  /** User's login identifier */
  login: string;
  /** Timestamp of last activity, null if no activity recorded */
  lastActivity: Date | null;
  /** Type of activity recorded */
  type: string;
};

/**
 * Base arguments for activity handlers
 * @template T - Type of handler-specific configuration
 */
export type LastActivityHandlerArgs<T = unknown> = {
  /** Activity record being processed */
  lastActivityRecord: LastActivityRecord;
  /** Optional handler-specific configuration */
  handlerConfig?: T;
};

/**
 * Schema factory for validating handler arguments
 * @template T - Zod schema type for handler config
 * @param configSchema - Zod schema for validating handler config
 * @returns Zod schema for validating handler arguments
 */
export const HandlerArgsSchema = <T extends z.ZodType>(configSchema: T) =>
  z.object({
    lastActivityRecord: LastActivityRecordSchema,
    handlerConfig: configSchema,
  });

/**
 * Strongly typed handler arguments
 * @template TConfig - Type of handler configuration
 */
export type HandlerArgs<TConfig> = {
  /** Activity record being processed */
  lastActivityRecord: LastActivityRecord;
  /** Handler-specific configuration */
  handlerConfig: TConfig;
};

/**
 * Handler for fetching activity records from the activity source
 * @template T - Type of extended configuration
 * @param args - Object containing lastFetchTime and implementation-specific config
 * @returns Promise<LastActivityRecord[]> Array of activity records
 */
export type FetchActivityHandler<T> = (
  args: {
    lastFetchTime: Date;
  } & T &
    PassedDormancyCheckConfiguration<T>,
) => Promise<LastActivityRecord[]>;

/**
 * Handler for custom activity logging implementation
 * @template T - Type of extended configuration
 * @param args - Combined LastActivityRecord and implementation config
 * @returns Promise<void>
 */
export type LogActivityHandler<T> = (
  args: LastActivityRecord & T & PassedDormancyCheckConfiguration<T>,
) => Promise<void>;

/**
 * Handler for checking if a user is inactive (legacy)
 * @deprecated Use IsDormantHandler instead
 * @template T - Type of extended configuration
 * @param args - Combined LastActivityRecord and implementation config
 * @returns Promise<boolean> true if user is inactive
 */
export type IsUserInactiveHandler<T> = (
  args: LastActivityRecord & T & PassedDormancyCheckConfiguration<T>,
) => Promise<boolean>;

/**
 * Handler for determining if a user should be considered dormant
 * @template T - Type of extended configuration
 * @param args - Combined LastActivityRecord and implementation config
 * @returns Promise<boolean> true if user is dormant
 */
export type IsDormantHandler<T> = (
  args: LastActivityRecord &
    T &
    PassedDormancyCheckConfiguration<T> & {
      checkTime: Date;
    },
) => Promise<boolean>;

/**
 * Handler for processing dormant users
 * @template T - Type of extended configuration
 * @param args - Combined LastActivityRecord and implementation config
 * @returns Promise<void>
 */
export type InactivityHandler<T, V = void> = (
  args: LastActivityRecord & T & PassedDormancyCheckConfiguration<T>,
) => Promise<V>;

/**
 * Handler for processing dormant users
 * @template T - Type of extended configuration
 * @param args - Combined LastActivityRecord and implementation config
 * @returns Promise<void>
 */
export type RemoveUserHandler<T, V = boolean> = (
  args: LastActivityRecord & T & PassedDormancyCheckConfiguration<T>,
) => Promise<V>;

/**
 * Handler for determining if a user should be whitelisted from dormancy checks
 * @template T - Type of extended configuration
 * @param args - Activity record and implementation config
 * @returns Promise<boolean> true if user should be whitelisted
 */
export type WhitelistHandler<T> = (
  args: LastActivityRecord & T & PassedDormancyCheckConfiguration<T>,
) => Promise<boolean>;

/**
 * Configuration for dormancy checking behavior
 * @template T - Type of extended configuration specific to the implementation
 */
export type DormancyCheckConfig<CheckType> = {
  /**
   * Unique identifier for this dormancy check configuration
   * Used to identify the database file and distinguish between different checks
   */
  type: string;

  /**
   * @todo- Rename to config
   */
  conf?: CheckType;

  /**
   * Optional path to the database file
   * If not provided, defaults to `${type}.json`
   */
  dbPath?: string;

  /**
   * When true, will simulate dormancy checks without taking action
   * Useful for testing configurations
   * @default false
   */
  dryRun?: boolean;

  /**
   * Duration of inactivity before a user is considered dormant
   * Can be specified in milliseconds, seconds, minutes, hours, or days
   * @default '30d'
   */
  duration?: DurationString;

  /**
   * Specifies how activity results should be interpreted.
   * - 'partial': Activity data is incomplete; absence doesn't indicate removal
   * - 'complete': Results represent all users; absence means removal
   *
   * @default 'partial'
   */
  activityResultType?: 'partial' | 'complete';

  /**
   * Determines if a user should be considered dormant based on their activity
   * @param args - Activity record and implementation config
   * @returns Promise resolving to true if user is dormant
   */
  isDormant?: IsDormantHandler<CheckType>;

  /**
   * Users that should never be considered dormant
   * Replaces static whitelist array with handler function
   * @param args - Activity record and implementation config
   * @returns Promise resolving to true if user should be whitelisted
   */
  isWhitelisted?: WhitelistHandler<CheckType>;

  /**
   * Fetches activity records from the activity source (e.g. GitHub, Copilot)
   * @param args - Object containing lastFetchTime and any implementation-specific config
   * @returns Promise resolving to array of activity records
   */
  fetchLatestActivity: FetchActivityHandler<CheckType>;

  /**
   * Optional custom handler for logging user activity
   * If not provided, activity will be stored in the default database
   * @param args - Activity record and implementation config
   */
  logActivityForUser?: LogActivityHandler<CheckType>;

  /**
   * Optional handler called when a user is determined to be dormant
   * Use this to take action on dormant users (e.g. remove from team)
   * Only called if isDormant returns true and dryRun is false
   * @param args - Activity record and implementation config
   */
  inactivityHandler?: InactivityHandler<CheckType>;

  /**
   * Optional handler used to remove a user from the system. Not called automatically.
   * @param args - Activity record and implementation config
   */
  removeUser?: RemoveUserHandler<CheckType>;
};

export type PassedDormancyCheckConfiguration<T> = RequireAllOrNone<
  Pick<DormancyCheckConfig<T>, 'dryRun' | 'duration'> & {
    checkType: DormancyCheckConfig<T>['type'];
    durationMillis?: number;
    logger: typeof logger;
  },
  'duration' | 'durationMillis'
>;

/**
 * Summary of account activity statistics including counts and percentages of active and dormant accounts
 */
export interface DormantAccountCheckSummary {
  /** ISO string timestamp of the last activity fetch */
  lastActivityFetch: string;
  /** Total number of accounts in the system */
  totalAccounts: number;
  /** Number of active accounts */
  activeAccounts: number;
  /** Number of dormant accounts */
  dormantAccounts: number;
  /** Percentage of total accounts that are dormant */
  dormantAccountPercentage: number;
  /** Percentage of total accounts that are active */
  activeAccountPercentage: number;
  /** Duration threshold for considering an account dormant */
  duration: DurationString;
}

/**
 * Categorized mapping of user activity records
 */
export interface DormantAccountStatusMap {
  /** Array of activity records for active users */
  active: LastActivityRecord[];
  /** Array of activity records for dormant users */
  dormant: LastActivityRecord[];
}

export interface Activity {
  /**
   * Retrieves all activity records from the database
   * @returns Promise<unknown>
   */
  all: () => Promise<unknown>;

  /**
   * Removes a user from the activity records
   * @param user - User's login or activity record to be removed
   * @returns Promise<void>
   */
  remove: (user: LastActivityRecord | string) => Promise<boolean>;
}
