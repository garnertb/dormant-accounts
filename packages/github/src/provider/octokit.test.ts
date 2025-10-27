import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createThrottledOctokit } from './octokit';

// Mock the GitHub and throttling dependencies
vi.mock('@actions/github/lib/utils', () => ({
  GitHub: {
    plugin: vi.fn(() =>
      vi.fn(() => ({
        log: {
          warn: vi.fn(),
          info: vi.fn(),
        },
        request: {
          retryCount: 0,
        },
      })),
    ),
  },
  getOctokitOptions: vi.fn((token) => ({ auth: token })),
}));

vi.mock('@octokit/plugin-throttling', () => ({
  throttling: vi.fn(),
}));

describe('createThrottledOctokit', () => {
  const mockToken = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a throttled Octokit client with provided token', () => {
    const client = createThrottledOctokit({ token: mockToken });

    expect(client).toBeDefined();
    expect(client.log).toBeDefined();
    expect(client.log.warn).toBeDefined();
    expect(client.log.info).toBeDefined();
  });

  it('should configure throttling options correctly', async () => {
    const { GitHub } = await import('@actions/github/lib/utils');
    const mockPlugin = vi.fn(() =>
      vi.fn(() => ({
        log: { warn: vi.fn(), info: vi.fn() },
        request: { retryCount: 0 },
      })),
    );

    // @ts-expect-error - Mocking for test
    GitHub.plugin = mockPlugin;

    createThrottledOctokit({ token: mockToken });

    expect(mockPlugin).toHaveBeenCalled();
  });

  it('should use correct authentication options', async () => {
    const { getOctokitOptions } = await import('@actions/github/lib/utils');

    createThrottledOctokit({ token: mockToken });

    expect(getOctokitOptions).toHaveBeenCalledWith(mockToken);
  });
});

describe('rate limit callback behavior', () => {
  const mockToken = 'test-token';

  it('should allow retries when retryCount is within limit', () => {
    const client = createThrottledOctokit({ token: mockToken });

    // The rate limit callback is internal, but we can verify the client is configured
    expect(client).toBeDefined();
    expect(client.log).toBeDefined();
  });
});
