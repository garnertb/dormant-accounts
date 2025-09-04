import { throttling } from '@octokit/plugin-throttling';
import * as github from '@actions/github/lib/utils.js';
import type { OctokitClient } from './provider/types';

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
 * This function provides a centralized way to create Octokit clients with:
 * - Automatic rate limit handling with configurable retry logic
 * - Secondary rate limit detection and handling
 * - Abuse detection logging
 * - Consistent throttling behavior across the application
 *
 * @param options - Configuration options for the Octokit client
 * @returns A configured Octokit client instance with throttling enabled
 */
export function createThrottledOctokit({
  token,
}: ThrottledOctokitOptions): OctokitClient {
  /**
   * Rate limit callback handler for both primary and secondary rate limits.
   * Retries up to MAX_RETRY_COUNT times when rate limit is hit.
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ThrottledOctokit = github.GitHub.plugin(throttling as any);

  // Initialize GitHub client with throttling
  const octokit = new ThrottledOctokit({
    ...github.getOctokitOptions(token),
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
  }) as OctokitClient;

  return octokit;
}
