import { type getOctokit } from '@actions/github';
import { type DormancyCheckConfig } from 'dormant-accounts';

export type OctokitClient = ReturnType<typeof getOctokit>;

/**
 * Controls how `last_authenticated_at` is used when determining Copilot activity.
 *
 * - `'ignore'` (default): Only use `last_activity_at`, falling back to `created_at`
 * - `'fallback'`: Use `last_authenticated_at` when `last_activity_at` is undefined
 * - `'most-recent'`: Use the most recent of `last_activity_at` and `last_authenticated_at`
 */
export type AuthenticatedAtBehavior = 'ignore' | 'fallback' | 'most-recent';

export interface GitHubHandlerConfig {
  octokit: OctokitClient;
  org: string;
  notificationRepo?: string;
  inactiveUserLabel?: string;
  notificationBody?: string;
  /**
   * Controls how `last_authenticated_at` is used when determining activity.
   * @default 'ignore'
   */
  authenticatedAtBehavior?: AuthenticatedAtBehavior;
}

type DefaultedProps = 'type' | 'activityResultType' | 'fetchLatestActivity';
export type GitHubHandlerArgs = Omit<
  DormancyCheckConfig<GitHubHandlerConfig>,
  DefaultedProps
> &
  Partial<Pick<DormancyCheckConfig<GitHubHandlerConfig>, DefaultedProps>>;
