import { type getOctokit } from '@actions/github';
import { type DormancyCheckConfig } from 'dormant-accounts';

export type OctokitClient = ReturnType<typeof getOctokit>;
export interface GitHubHandlerConfig {
  octokit: OctokitClient;
  org: string;
  notificationRepo?: string;
  inactiveUserLabel?: string;
  notificationBody?: string;
}

type DefaultedProps = 'type' | 'fetchLatestActivity';
export type GitHubHandlerArgs = Omit<
  DormancyCheckConfig<GitHubHandlerConfig>,
  DefaultedProps
> &
  Partial<Pick<DormancyCheckConfig<GitHubHandlerConfig>, DefaultedProps>>;
