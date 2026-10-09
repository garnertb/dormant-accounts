import * as core from '@actions/core';
import { writeFile } from 'fs/promises';
import { OctokitClient } from '@dormant-accounts/github';
import { checkBranch } from './checkBranch';
import { createBranch } from './createBranch';
import { getActivityLog } from './getActivityLog';
import { RepoContext } from './repository';
import { updateActivityLog } from './updateActivityLog';

/**
 * Where an activity log is stored
 */
export interface ActivityLogLocation {
  /** Repository holding the activity log */
  repo: RepoContext;
  /** Branch holding the activity log */
  branch: string;
  /** Path of the log file, used both in the repository and locally */
  path: string;
}

/**
 * Downloads the stored activity log to the local file at `path`.
 *
 * @param octokit - The Octokit client instance
 * @param location - Where the activity log is stored
 * @returns The blob SHA of the stored log, or undefined when no log exists yet
 * @throws When the log exists but cannot be read
 */
export async function loadActivityLog(
  octokit: OctokitClient,
  { repo, branch, path }: ActivityLogLocation,
): Promise<string | undefined> {
  const activityLog = await getActivityLog(octokit, repo, branch, path);

  if (!activityLog) {
    core.info('Activity log does not exist, creating new one...');
    return undefined;
  }

  await writeFile(path, activityLog.content);
  core.info(`Activity log fetched and saved to ${path}`);
  return activityLog.sha;
}

/**
 * Options for {@link saveActivityLog}
 */
export interface SaveActivityLogOptions extends ActivityLogLocation {
  /** Activity log contents, serialized as formatted JSON */
  content: unknown;
  /** Commit message */
  message: string;
  /** Blob SHA of the log being replaced, if one exists */
  sha?: string;
}

/**
 * Commits the activity log, creating the branch when it does not exist.
 *
 * @param octokit - The Octokit client instance
 * @param options - The log location, contents and commit details
 * @returns The result of the file update
 */
export async function saveActivityLog(
  octokit: OctokitClient,
  { repo, branch, path, content, message, sha }: SaveActivityLogOptions,
) {
  if (await checkBranch(octokit, repo, branch)) {
    core.debug(`Branch already exists: ${branch}`);
  } else {
    core.info(`Creating branch: ${branch}`);
    await createBranch(octokit, repo, branch);
  }

  return updateActivityLog(octokit, repo, {
    branch,
    path,
    sha,
    message,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
  });
}
