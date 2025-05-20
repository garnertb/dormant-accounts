export {
  githubDormancy,
  copilotDormancy,
  GithubIssueNotifier,
  createDefaultNotificationBodyHandler,
  revokeCopilotLicense,
  removeCopilotUserFromTeam,
  type ProcessingResult,
} from './provider';

export type { OctokitClient } from './provider/types';
export type { LastActivityRecord } from 'dormant-accounts';
