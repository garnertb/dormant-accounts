import * as core from '@actions/core';
import { OctokitClient } from '@dormant-accounts/github';
import { errorMessage, errorStatus } from './errors';
import { RepoContext } from './repository';

/**
 * An activity log file and the blob SHA needed to update it
 */
export interface ActivityLogFile {
  content: string;
  sha: string;
}

/**
 * Decodes a raw blob response. Octokit returns a string for text responses
 * and an ArrayBuffer for other content types.
 *
 * @param data - The response data
 * @returns The content as UTF-8 text
 */
const decodeContent = (data: unknown): string => {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      'utf8',
    );
  }
  throw new Error(`unexpected content type: ${typeof data}`);
};

/**
 * Fetches the activity log from the specified branch.
 *
 * The file's blob is read through the raw media type, so logs larger than the
 * contents API's 1 MB limit are returned in full.
 *
 * @param octokit - The Octokit client instance
 * @param context - The repository holding the activity log
 * @param branchName - The branch holding the activity log
 * @param path - Path of the activity log file
 * @returns The log content and blob SHA, or false when the branch or file does not exist
 * @throws When the log exists but cannot be read or is not valid JSON
 */
export async function getActivityLog(
  octokit: OctokitClient,
  context: RepoContext,
  branchName: string,
  path: string,
): Promise<ActivityLogFile | false> {
  core.debug(`checking for activity log ${path} on branch ${branchName}`);

  const failure = (error: unknown) =>
    new Error(
      `Failed to read activity log ${path} on branch ${branchName}: ${errorMessage(error)}`,
      { cause: error },
    );

  let sha: string;
  try {
    const { data } = await octokit.rest.repos.getContent({
      ...context,
      path,
      ref: branchName,
      mediaType: { format: 'object' },
    });

    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error('path is not a file');
    }
    sha = data.sha;
  } catch (error) {
    if (errorStatus(error) === 404) {
      core.info(`🔍 activity log does not exist on branch: ${branchName}`);
      return false;
    }
    throw failure(error);
  }

  try {
    const { data } = await octokit.rest.git.getBlob({
      ...context,
      file_sha: sha,
      mediaType: { format: 'raw' },
    });
    const content = decodeContent(data);
    JSON.parse(content);
    return { content, sha };
  } catch (error) {
    throw failure(error);
  }
}
