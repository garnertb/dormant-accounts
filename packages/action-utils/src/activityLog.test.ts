import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OctokitClient } from '@dormant-accounts/github';
import { loadActivityLog, saveActivityLog } from './activityLog';
import { getActivityLog } from './getActivityLog';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const repo = { owner: 'acme', repo: 'logs' };
const log = { _state: { lastRun: '2025-01-01T00:00:00.000Z' }, alice: {} };
const logText = JSON.stringify(log);

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

const fileResponse = (sha = 'blob-sha') => ({
  data: { type: 'file', sha, content: '', encoding: 'none' },
});

const createOctokit = ({
  getContent = vi.fn(async () => fileResponse()),
  getBlob = vi.fn(async (): Promise<{ data: unknown }> => ({ data: logText })),
} = {}) => ({
  octokit: {
    rest: { repos: { getContent }, git: { getBlob } },
  } as unknown as OctokitClient,
  getContent,
  getBlob,
});

describe('getActivityLog', () => {
  it('reads the blob through the raw media type', async () => {
    const { octokit, getContent, getBlob } = createOctokit();

    await expect(
      getActivityLog(octokit, repo, 'github-dormancy', 'github-dormancy.json'),
    ).resolves.toEqual({ content: logText, sha: 'blob-sha' });

    expect(getContent).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repo,
        path: 'github-dormancy.json',
        ref: 'github-dormancy',
        mediaType: { format: 'object' },
      }),
    );
    expect(getBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repo,
        file_sha: 'blob-sha',
        mediaType: { format: 'raw' },
      }),
    );
  });

  it.each<[string, () => unknown]>([
    ['an ArrayBuffer', () => new TextEncoder().encode(logText).buffer],
    ['a Uint8Array', () => new TextEncoder().encode(logText)],
  ])('decodes %s response', async (_name, data) => {
    const { octokit } = createOctokit({
      getBlob: vi.fn(async () => ({ data: data() })),
    });

    await expect(
      getActivityLog(octokit, repo, 'branch', 'log.json'),
    ).resolves.toEqual({ content: logText, sha: 'blob-sha' });
  });

  it('returns false when the branch or file does not exist', async () => {
    const { octokit, getBlob } = createOctokit({
      getContent: vi.fn(async () => {
        throw httpError(404);
      }),
    });

    await expect(
      getActivityLog(octokit, repo, 'branch', 'log.json'),
    ).resolves.toBe(false);
    expect(getBlob).not.toHaveBeenCalled();
  });

  it.each<[string, Parameters<typeof createOctokit>[0]]>([
    [
      'the contents request fails',
      {
        getContent: vi.fn(async () => {
          throw httpError(500);
        }),
      },
    ],
    [
      'the blob request fails',
      {
        getBlob: vi.fn(async () => {
          throw httpError(403);
        }),
      },
    ],
    [
      'the path is a directory',
      { getContent: vi.fn(async () => ({ data: [] })) as never },
    ],
    [
      'the path is not a file',
      {
        getContent: vi.fn(async () => ({
          data: { type: 'submodule', sha: 'x' },
        })) as never,
      },
    ],
    [
      'the content is not valid JSON',
      { getBlob: vi.fn(async () => ({ data: '{"truncated":' })) },
    ],
  ])('throws when %s', async (_name, overrides) => {
    const { octokit } = createOctokit(overrides);

    await expect(
      getActivityLog(octokit, repo, 'branch', 'log.json'),
    ).rejects.toThrow(/Failed to read activity log log\.json on branch branch/);
  });
});

describe('loadActivityLog', () => {
  const cwd = process.cwd();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'action-utils-'));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the stored log locally and returns its sha', async () => {
    const { octokit } = createOctokit();

    await expect(
      loadActivityLog(octokit, { repo, branch: 'b', path: 'log.json' }),
    ).resolves.toBe('blob-sha');
    await expect(readFile(join(dir, 'log.json'), 'utf8')).resolves.toBe(
      logText,
    );
  });

  it('returns undefined without writing when no log exists', async () => {
    const { octokit } = createOctokit({
      getContent: vi.fn(async () => {
        throw httpError(404);
      }),
    });

    await expect(
      loadActivityLog(octokit, { repo, branch: 'b', path: 'log.json' }),
    ).resolves.toBeUndefined();
    await expect(readFile(join(dir, 'log.json'), 'utf8')).rejects.toThrow();
  });
});

describe('saveActivityLog', () => {
  const createWriteOctokit = (branchExists: boolean) => {
    const rest = {
      repos: {
        getBranch: vi.fn(async ({ branch }: { branch: string }) => {
          if (branch === 'main') {
            return { data: { commit: { sha: 'main-sha' } } };
          }
          if (branchExists) {
            return { data: { commit: { sha: 'log-sha' } } };
          }
          throw httpError(404);
        }),
        get: vi.fn(async () => ({ data: { default_branch: 'main' } })),
        createOrUpdateFileContents: vi.fn(async () => ({ data: {} })),
      },
      git: { createRef: vi.fn(async () => ({ data: {} })) },
    };
    return { octokit: { rest } as unknown as OctokitClient, rest };
  };

  const options = {
    repo,
    branch: 'github-dormancy',
    path: 'github-dormancy.json',
    content: log,
    message: 'Update log',
    sha: 'old-sha',
  };

  it('creates the branch from the default branch when it is missing', async () => {
    const { octokit, rest } = createWriteOctokit(false);

    await saveActivityLog(octokit, options);

    expect(rest.git.createRef).toHaveBeenCalledWith({
      ...repo,
      ref: 'refs/heads/github-dormancy',
      sha: 'main-sha',
    });
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repo,
        branch: 'github-dormancy',
        path: 'github-dormancy.json',
        sha: 'old-sha',
        message: 'Update log',
        content: Buffer.from(JSON.stringify(log, null, 2)).toString('base64'),
      }),
    );
  });

  it('writes to an existing branch without creating it', async () => {
    const { octokit, rest } = createWriteOctokit(true);

    await saveActivityLog(octokit, options);

    expect(rest.git.createRef).not.toHaveBeenCalled();
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });
});
