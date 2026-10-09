import type { DormancyCheckConfig } from 'dormant-accounts';
import type { GitHubHandlerConfig, OctokitClient } from '../types';

/**
 * Repository holding notification issues whose comments count as activity
 */
export interface NotificationCommentSource {
  /** Client used to read the repository; defaults to the check's client */
  octokit?: OctokitClient;
  /** Owner of the notification repository */
  owner: string;
  /** Name of the notification repository */
  repo: string;
  /** Labels carried by every notification issue */
  baseLabels: string[];
}

/**
 * Configuration for {@link githubMembershipDormancy}
 */
export interface GitHubMembershipConfig extends GitHubHandlerConfig {
  /**
   * Include outside collaborators in the accounts checked
   * @default false
   */
  includeOutsideCollaborators?: boolean;

  /**
   * Count Copilot seat activity, including seats pending cancellation. A
   * seat's assignment date (`created_at`) is not activity.
   * @default false
   */
  includeCopilotActivity?: boolean;

  /**
   * Count a user's comments on their own open notification issue as activity
   */
  countNotificationComments?: NotificationCommentSource;

  /**
   * Proceed when the last run is older than the audit log's 7 day retention for
   * git events. Git activity inside the gap is missed.
   * @default false
   */
  allowActivityGap?: boolean;

  /**
   * Audit log actions that are not activity, matched exactly and ignoring
   * case. A user's other events still count. Defaults to actions that GitHub
   * records for a user without the user doing anything. Pass `[]` to count
   * every action.
   * @default DEFAULT_IGNORED_AUDIT_ACTIONS
   */
  ignoreAuditActions?: readonly string[];
}

type ForcedProps =
  | 'activityResultType'
  | 'activityMergeStrategy'
  | 'logActivityForUser'
  | 'conf';

type DefaultedProps =
  | 'type'
  | 'fetchLatestActivity'
  | 'isWhitelisted'
  | 'firstSeenBaseline';

/**
 * Arguments for {@link githubMembershipDormancy}. Activity is always a complete
 * snapshot merged with the `latest` strategy.
 */
export type GitHubMembershipArgs = Omit<
  DormancyCheckConfig<GitHubMembershipConfig>,
  ForcedProps | DefaultedProps
> &
  Partial<Pick<DormancyCheckConfig<GitHubMembershipConfig>, DefaultedProps>> & {
    conf: GitHubMembershipConfig;
  };
