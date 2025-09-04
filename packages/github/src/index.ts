export {
  githubDormancy,
  GithubIssueNotifier,
  createDefaultNotificationBodyHandler,
  type NotificationHandlerContext,
  type NotificationBodyHandler,
  type ProcessingResult,
} from './provider';

export {
  createThrottledOctokit,
  type ThrottledOctokitOptions,
} from './octokit';

export type { OctokitClient } from './provider/types';
export type { LastActivityRecord } from 'dormant-accounts';
