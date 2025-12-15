export {
  githubDormancy,
  GithubIssueNotifier,
  createDefaultNotificationBodyHandler,
  type NotificationHandlerContext,
  type NotificationBodyHandler,
  type ProcessingResult,
} from './provider';

export type { OctokitClient, AuthenticatedAtBehavior } from './provider/types';
export type { LastActivityRecord } from 'dormant-accounts';
