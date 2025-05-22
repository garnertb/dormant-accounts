import * as core from '@actions/core';
import { OctokitClient, LastActivityRecord } from '@dormant-accounts/github';
import {
  revokeCopilotLicense,
  removeCopilotUserFromTeam,
} from '@dormant-accounts/github/copilot';
import { Activity } from 'dormant-accounts';

interface RemoveCopilotAccountParams {
  activity: Activity;
  allowTeamRemoval: boolean;
  lastActivityRecord: LastActivityRecord;
  octokit: OctokitClient;
  owner: string;
  removeDormantAccounts: boolean;
}

/**
 * Removes a user's Copilot license by revoking directly or removing them from a Copilot team
 * based on their provisioning method.
 *
 * @param activity - Activity tracker to record removals
 * @param allowTeamRemoval - Flag indicating if users can be removed from teams that provision Copilot
 * @param lastActivityRecord - User activity record containing login info
 * @param octokit - The Octokit instance for API calls
 * @param owner - The organization owner
 * @param removeDormantAccounts - Flag indicating if accounts should actually be removed
 * @returns Promise<boolean> - True if account was removed, false otherwise
 */
export const removeCopilotLicense = async ({
  lastActivityRecord,
  octokit,
  owner,
  removeDormantAccounts,
  allowTeamRemoval,
  activity,
}: RemoveCopilotAccountParams): Promise<boolean> => {
  const {
    data: { pending_cancellation_date, assigning_team },
  } = await octokit.rest.copilot.getCopilotSeatDetailsForUser({
    username: lastActivityRecord.login,
    org: owner,
  });

  if (pending_cancellation_date) {
    core.info(
      `User ${lastActivityRecord.login} already has a pending cancellation date: ${pending_cancellation_date}`,
    );
    return true;
  }

  if (!removeDormantAccounts) {
    core.info(
      `remove-dormant-accounts setting is disabled, checking if user ${lastActivityRecord.login} has been removed from Copilot externally`,
    );

    return false;
  }

  let accountRemoved = false;
  // When `assigning_team` is not null, the user is provisioned access for GitHub Copilot via a team
  // and we need to remove them from that team if allowTeamRemoval is true
  if (assigning_team) {
    if (!allowTeamRemoval) {
      core.info(
        `User ${lastActivityRecord.login} is part of team "${assigning_team.name}" that provisions Copilot access, but team removal is disabled for safety`,
      );
      return false;
    }

    core.info(
      `User ${lastActivityRecord.login} is part of a team, attempting to remove from team ${assigning_team.name}`,
    );
    accountRemoved = await removeCopilotUserFromTeam({
      username: lastActivityRecord.login,
      octokit,
      org: owner,
      dryRun: !removeDormantAccounts,
    });
  } else {
    accountRemoved = await revokeCopilotLicense({
      logins: lastActivityRecord.login,
      octokit,
      org: owner,
      dryRun: !removeDormantAccounts,
    });
  }

  if (accountRemoved) {
    core.info(
      `Successfully removed Copilot license for ${lastActivityRecord.login}`,
    );
    await activity.remove(lastActivityRecord.login);
  }

  return accountRemoved;
};
