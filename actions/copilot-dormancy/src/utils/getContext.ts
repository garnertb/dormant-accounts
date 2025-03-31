import * as core from '@actions/core';
import * as z from 'zod';
import * as github from '@actions/github';
import { githubDormancy, copilotDormancy } from '@dormant-accounts/github';

const GitHubChecks = {
  'copilot-dormancy': copilotDormancy,
  'github-dormancy': githubDormancy,
};

const contextSchema = z
  .object({
    /**
     * Org to check for dormant accounts
     * @example 'my-org'
     */
    org: z.string(),

    /**
     * Repository to store the activity log
     * @example 'my-org/activity-log-repo'
     */
    activityLogRepo: z.string().includes('/'),
    token: z.string(),
    checkType: z.enum(['copilot-dormancy', 'github-dormancy']),
    duration: z.string(),
    dryRun: z.boolean().optional().default(false),
  })
  .transform((data) => {
    const {
      activityLogRepo,
      dryRun,
      token,
      checkType,
      duration,
      org,
      ...rest
    } = data;
    const [owner, repo] = activityLogRepo.split('/');
    const octokit = github.getOctokit(token);

    const check = GitHubChecks[checkType]({
      type: checkType,
      duration,
      dryRun,
      conf: {
        octokit,
        org,
      },
    });

    if (!dryRun && (!owner || !repo)) {
      throw new Error(
        `Invalid activity log repo format. Expected "owner/repo", got "${activityLogRepo}"`,
      );
    }

    return {
      octokit,
      dryRun,
      check,
      org,
      duration,
      activityLog: {
        branchName: data.checkType,
        path: `${data.checkType}.json`,
        repo: {
          owner: owner as string,
          repo: repo as string,
        },
      },
      ...rest,
    };
  });

export type Context = z.infer<typeof contextSchema>;

/**
 * Retrieves the context from the action inputs.
 * @returns An object containing the notification context or false if notifications are disabled
 */
export function getContext(): Context | false {
  const validContext = contextSchema.safeParse({
    org: core.getInput('org'),
    activityLogRepo: core.getInput('activity-log-repo'),
    duration: core.getInput('duration'),
    dryRun: core.getInput('dry-run') === 'true',
    token: core.getInput('token'),
    checkType: core.getInput('check-type'),
  });

  if (!validContext.success) {
    core.setFailed(`Invalid action inputs: ${validContext.error.message}`);
    return false;
  }

  core.debug(`Parsed context: ${JSON.stringify(validContext.data, null, 2)}`);

  return validContext.data;
}
