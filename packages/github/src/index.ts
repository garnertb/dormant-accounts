export {
  githubDormancy,
  defaultWhitelistHandler,
  GithubIssueNotifier,
  NotificationStatus,
  normalizeRemoveAccountOutcome,
  createDefaultNotificationBodyHandler,
  type NotificationHandlerContext,
  type NotificationBodyHandler,
  type ProcessingResult,
  type ProcessDormantUsersOptions,
  type RemoveAccountContext,
  type RemoveAccountHandler,
  type RemoveAccountOutcome,
} from './provider';
export * from './provider/membership';

export type { OctokitClient, AuthenticatedAtBehavior } from './provider/types';
export type { LastActivityRecord } from 'dormant-accounts';
