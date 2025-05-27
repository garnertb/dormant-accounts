import { throttling } from '@octokit/plugin-throttling';
import { GitHub, getOctokitOptions } from '@actions/github/lib/utils';
import { OctokitClient } from '@dormant-accounts/github';

const MAX_RETRY_COUNT = 3;

/**
 * Configuration options for creating a throttled Octokit client
 */
export interface ThrottledOctokitOptions {
  /** GitHub token for authentication */
  token: string;
}

/**
 * Creates a throttled Octokit client with rate limiting and abuse detection handlers.
 *
 * @param options - Configuration options for the Octokit client
 * @returns A configured Octokit client instance with throttling enabled
 */
export function createThrottledOctokit({
  token,
}: ThrottledOctokitOptions): OctokitClient {
  /**
   * Rate limit callback handler for both primary and secondary rate limits.
   * Retries once when rate limit is hit.
   */
  const rateLimitCallBack = (
    retryAfter: number,
    options: any,
    octokit: OctokitClient,
  ) => {
    octokit.log.warn(
      `Request quota exhausted for request ${options.method} ${options.url}`,
    );

    if (options.request.retryCount <= MAX_RETRY_COUNT) {
      octokit.log.info(`Retrying after ${retryAfter} seconds!`);
      return true;
    }
  };

  // @ts-expect-error
  const ThrottledOctokit = GitHub.plugin(throttling);

  // Initialize GitHub client with throttling
  const octokit = new ThrottledOctokit({
    ...getOctokitOptions(token),
    throttle: {
      onRateLimit: rateLimitCallBack,
      onSecondaryRateLimit: rateLimitCallBack,
      onAbuseLimit: (
        _retryAfter: number,
        options: any,
        octokit: OctokitClient,
      ) => {
        // does not retry, only logs a warning
        octokit.log.warn(
          `Abuse detected for request ${options.method} ${options.url}`,
        );
      },
    },
  });

  return octokit;
}
