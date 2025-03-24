export {
  githubDormancy,
  copilotDormancy,
  GithubIssueNotifier,
  createDefaultNotificationBodyHandler,
} from './provider';

export type { OctokitClient } from './provider/types';
export type { LastActivityRecord } from 'dormant-accounts';
