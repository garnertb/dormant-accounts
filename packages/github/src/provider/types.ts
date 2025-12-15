import { type getOctokit } from '@actions/github';
import { type DormancyCheckConfig } from 'dormant-accounts';

export type OctokitClient = ReturnType<typeof getOctokit>;
export interface GitHubHandlerConfig {
  octokit: OctokitClient;
  org: string;
  notificationRepo?: string;
  inactiveUserLabel?: string;
  notificationBody?: string;
  /**
   * When `true`, uses `last_authenticated_at` as a fallback for activity when
   * `last_activity_at` is undefined. Defaults to `false`.
   */
  useAuthenticatedAtAsFallback?: boolean;
}

type DefaultedProps = 'type' | 'activityResultType' | 'fetchLatestActivity';
export type GitHubHandlerArgs = Omit<
  DormancyCheckConfig<GitHubHandlerConfig>,
  DefaultedProps
> &
  Partial<Pick<DormancyCheckConfig<GitHubHandlerConfig>, DefaultedProps>>;
