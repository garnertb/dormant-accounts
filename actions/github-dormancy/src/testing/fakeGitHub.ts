import type { OctokitClient } from '@dormant-accounts/github';

/**
 * Error shaped like an Octokit request error
 */
export const httpError = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

/**
 * Endpoints served by the fake
 */
export type FakeEndpoint =
  | 'orgs.listMembers'
  | 'orgs.listOutsideCollaborators'
  | 'orgs.getMembershipForUser'
  | 'orgs.removeMembershipForUser'
  | 'orgs.removeOutsideCollaborator'
  | 'auditLog'
  | 'copilot.listCopilotSeats'
  | 'issues.listForRepo'
  | 'issues.listCommentsForRepo'
  | 'issues.listComments'
  | 'issues.create'
  | 'issues.createComment'
  | 'issues.addLabels'
  | 'issues.removeLabel'
  | 'issues.update'
  | 'repos.get'
  | 'repos.getBranch'
  | 'repos.getContent'
  | 'repos.createOrUpdateFileContents'
  | 'git.getBlob'
  | 'git.createRef';

/**
 * Endpoints that change state
 */
export const WRITE_ENDPOINTS: readonly FakeEndpoint[] = [
  'orgs.removeMembershipForUser',
  'orgs.removeOutsideCollaborator',
  'issues.create',
  'issues.createComment',
  'issues.addLabels',
  'issues.removeLabel',
  'issues.update',
  'repos.createOrUpdateFileContents',
  'git.createRef',
];

export interface FakeComment {
  login: string;
  created_at: string;
  body?: string;
}

export interface FakeIssue {
  /** Repository in `owner/repo` form */
  repo: string;
  number: number;
  title: string;
  created_at: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: string[];
  body?: string;
  assignees?: string[];
  comments: FakeComment[];
  pull_request?: object;
}

export interface FakeAuditEntry {
  actor: string;
  action: string;
  '@timestamp': number;
}

export interface FakeCall {
  token: string;
  endpoint: FakeEndpoint;
  params: Record<string, any>;
}

export interface FakeFile {
  content: string;
  sha: string;
  message?: string;
}

/**
 * Mutable state shared by every client created by a {@link FakeGitHub}
 */
export interface FakeGitHubState {
  org: string;
  members: Set<string>;
  owners: Set<string>;
  outsideCollaborators: Set<string>;
  auditEntries: FakeAuditEntry[];
  seats: Array<Record<string, unknown>>;
  issues: FakeIssue[];
  /** Files keyed by `owner/repo@branch:path` */
  files: Map<string, FakeFile>;
  /** Branches other than the default branch, as `owner/repo@branch` */
  branches: Set<string>;
  /** Errors thrown by an endpoint instead of handling the request */
  failures: Partial<Record<FakeEndpoint, unknown>>;
  /** Callbacks run before an endpoint handles a request, to change state mid-run */
  hooks: Partial<Record<FakeEndpoint, (params: Record<string, any>) => void>>;
  calls: FakeCall[];
}

export interface FakeGitHubInit {
  org: string;
  members?: string[];
  owners?: string[];
  outsideCollaborators?: string[];
  auditEntries?: FakeAuditEntry[];
  seats?: Array<Record<string, unknown>>;
}

export interface FakeGitHub {
  state: FakeGitHubState;
  /** Creates a client whose calls are recorded against `token` */
  client: (token: string) => OctokitClient;
  /** Stores a file as JSON and creates its branch */
  putFile: (
    location: { repo: string; branch: string; path: string },
    content: unknown,
  ) => void;
  /** Parses a stored JSON file, or returns undefined when it does not exist */
  readFile: (location: { repo: string; branch: string; path: string }) => any;
  /** Adds an issue and returns it */
  addIssue: (
    issue: Pick<FakeIssue, 'repo' | 'title' | 'created_at' | 'labels'> &
      Partial<FakeIssue>,
  ) => FakeIssue;
  /** Finds an issue by repository and exact title */
  findIssue: (repo: string, title: string) => FakeIssue | undefined;
  /** Recorded calls, optionally filtered by endpoint */
  callsTo: (endpoint?: FakeEndpoint) => FakeCall[];
  /** Recorded calls to endpoints that change state */
  writes: () => FakeCall[];
}

const DEFAULT_BRANCH = 'main';

const repoKey = ({ owner, repo }: Record<string, any>) => `${owner}/${repo}`;

const fileKey = (repo: string, branch: string, path: string) =>
  `${repo}@${branch}:${path}`;

const toApiIssue = (issue: FakeIssue) => ({
  number: issue.number,
  title: issue.title,
  created_at: issue.created_at,
  state: issue.state,
  state_reason: issue.state_reason ?? null,
  body: issue.body ?? '',
  labels: issue.labels.map((name) => ({ name })),
  assignees: (issue.assignees ?? []).map((login) => ({ login })),
  ...(issue.pull_request ? { pull_request: issue.pull_request } : {}),
});

const toApiComment = (comment: FakeComment) => ({
  user: { login: comment.login },
  created_at: comment.created_at,
  body: comment.body ?? '',
});

/**
 * Creates an in-memory GitHub that serves the endpoints used by the action.
 * Clients created for different tokens share state, and every request is
 * recorded with the token that made it.
 *
 * @param init - Organization, members and activity
 * @returns The fake and helpers to inspect it
 */
export const createFakeGitHub = (init: FakeGitHubInit): FakeGitHub => {
  const state: FakeGitHubState = {
    org: init.org,
    members: new Set(init.members),
    owners: new Set(init.owners),
    outsideCollaborators: new Set(init.outsideCollaborators),
    auditEntries: [...(init.auditEntries ?? [])],
    seats: [...(init.seats ?? [])],
    issues: [],
    files: new Map(),
    branches: new Set(),
    failures: {},
    hooks: {},
    calls: [],
  };

  let shaCounter = 0;
  const nextSha = () => `sha-${++shaCounter}`;

  const assertOrg = (params: Record<string, any>) => {
    if (params.org !== state.org) throw httpError(404, 'Not Found');
  };

  const findIssueByNumber = (params: Record<string, any>) => {
    const issue = state.issues.find(
      (candidate) =>
        candidate.repo === repoKey(params) &&
        candidate.number === params.issue_number,
    );
    if (!issue) throw httpError(404, 'Not Found');
    return issue;
  };

  const branchExists = (repo: string, branch: string) =>
    branch === DEFAULT_BRANCH || state.branches.has(`${repo}@${branch}`);

  const removeLogin = (set: Set<string>, username: string) => {
    for (const login of set) {
      if (login.toLowerCase() === username.toLowerCase()) set.delete(login);
    }
  };

  const hasLogin = (set: Set<string>, username: string) =>
    [...set].some((login) => login.toLowerCase() === username.toLowerCase());

  const handlers: Record<
    FakeEndpoint,
    (params: Record<string, any>) => unknown
  > = {
    'orgs.listMembers': (params) => {
      assertOrg(params);
      const role = params.role ?? 'all';
      return [
        ...(role === 'admin' ? [] : state.members),
        ...(role === 'member' ? [] : state.owners),
      ].map((login) => ({ login }));
    },
    'orgs.listOutsideCollaborators': (params) => {
      assertOrg(params);
      return [...state.outsideCollaborators].map((login) => ({ login }));
    },
    'orgs.getMembershipForUser': (params) => {
      assertOrg(params);
      if (hasLogin(state.owners, params.username)) {
        return { role: 'admin', state: 'active' };
      }
      if (hasLogin(state.members, params.username)) {
        return { role: 'member', state: 'active' };
      }
      throw httpError(404, 'Not Found');
    },
    'orgs.removeMembershipForUser': (params) => {
      assertOrg(params);
      removeLogin(state.members, params.username);
      removeLogin(state.owners, params.username);
      return null;
    },
    'orgs.removeOutsideCollaborator': (params) => {
      assertOrg(params);
      removeLogin(state.outsideCollaborators, params.username);
      return null;
    },
    auditLog: (params) => {
      assertOrg(params);
      const since = /created:>=(\S+)/.exec(params.phrase ?? '')?.[1];
      const sinceTime = since ? Date.parse(since) : -Infinity;
      return state.auditEntries
        .filter((entry) => entry['@timestamp'] >= sinceTime)
        .sort((a, b) => b['@timestamp'] - a['@timestamp']);
    },
    'copilot.listCopilotSeats': (params) => {
      assertOrg(params);
      return { total_seats: state.seats.length, seats: state.seats };
    },
    'issues.listForRepo': (params) => {
      const labels: string[] = params.labels ? params.labels.split(',') : [];
      const issueState = params.state ?? 'open';
      return state.issues
        .filter(
          (issue) =>
            issue.repo === repoKey(params) &&
            (issueState === 'all' || issue.state === issueState) &&
            labels.every((label) => issue.labels.includes(label)),
        )
        .map(toApiIssue);
    },
    'issues.listCommentsForRepo': (params) => {
      const since = params.since ? Date.parse(params.since) : -Infinity;
      return state.issues
        .filter((issue) => issue.repo === repoKey(params))
        .flatMap((issue) =>
          issue.comments
            .filter((comment) => Date.parse(comment.created_at) >= since)
            .map((comment) => ({
              ...toApiComment(comment),
              issue_url: `https://api.github.com/repos/${issue.repo}/issues/${issue.number}`,
            })),
        );
    },
    'issues.listComments': (params) =>
      findIssueByNumber(params).comments.map(toApiComment),
    'issues.create': (params) => {
      const issue: FakeIssue = {
        repo: repoKey(params),
        number: state.issues.length + 1,
        title: params.title,
        created_at: new Date().toISOString(),
        state: 'open',
        labels: [...(params.labels ?? [])],
        body: params.body,
        assignees: params.assignees,
        comments: [],
      };
      state.issues.push(issue);
      return toApiIssue(issue);
    },
    'issues.createComment': (params) => {
      const comment = {
        login: 'github-actions[bot]',
        created_at: new Date().toISOString(),
        body: params.body,
      };
      findIssueByNumber(params).comments.push(comment);
      return toApiComment(comment);
    },
    'issues.addLabels': (params) => {
      const issue = findIssueByNumber(params);
      issue.labels = [...new Set([...issue.labels, ...params.labels])];
      return issue.labels.map((name) => ({ name }));
    },
    'issues.removeLabel': (params) => {
      const issue = findIssueByNumber(params);
      if (!issue.labels.includes(params.name)) {
        throw httpError(404, 'Label does not exist');
      }
      issue.labels = issue.labels.filter((label) => label !== params.name);
      return issue.labels.map((name) => ({ name }));
    },
    'issues.update': (params) => {
      const issue = findIssueByNumber(params);
      if (params.state) issue.state = params.state;
      if (params.state_reason !== undefined) {
        issue.state_reason = params.state_reason;
      }
      return toApiIssue(issue);
    },
    'repos.get': () => ({ default_branch: DEFAULT_BRANCH }),
    'repos.getBranch': (params) => {
      if (!branchExists(repoKey(params), params.branch)) {
        throw httpError(404, 'Branch not found');
      }
      return { name: params.branch, commit: { sha: 'commit-sha' } };
    },
    'repos.getContent': (params) => {
      const file = state.files.get(
        fileKey(repoKey(params), params.ref, params.path),
      );
      if (!file) throw httpError(404, 'Not Found');
      return { type: 'file', path: params.path, sha: file.sha };
    },
    'repos.createOrUpdateFileContents': (params) => {
      const repo = repoKey(params);
      if (!branchExists(repo, params.branch)) {
        throw httpError(404, 'Branch not found');
      }
      const key = fileKey(repo, params.branch, params.path);
      const existing = state.files.get(key);
      if (existing?.sha !== params.sha) {
        throw httpError(409, 'sha does not match');
      }
      const file = {
        content: Buffer.from(params.content, 'base64').toString('utf8'),
        sha: nextSha(),
        message: params.message,
      };
      state.files.set(key, file);
      return { content: { sha: file.sha }, commit: { message: file.message } };
    },
    'git.getBlob': (params) => {
      const prefix = `${repoKey(params)}@`;
      const file = [...state.files].find(
        ([key, candidate]) =>
          key.startsWith(prefix) && candidate.sha === params.file_sha,
      )?.[1];
      if (!file) throw httpError(404, 'Not Found');
      return file.content;
    },
    'git.createRef': (params) => {
      const key = `${repoKey(params)}@${params.ref.replace(/^refs\/heads\//, '')}`;
      if (state.branches.has(key)) {
        throw httpError(422, 'Reference already exists');
      }
      state.branches.add(key);
      return { ref: params.ref, object: { sha: params.sha } };
    },
  };

  const client = (token: string): OctokitClient => {
    const endpoint =
      (name: FakeEndpoint) =>
      async (params: Record<string, any> = {}) => {
        state.calls.push({ token, endpoint: name, params });
        state.hooks[name]?.(params);
        if (state.failures[name]) throw state.failures[name];
        return { data: structuredClone(handlers[name](params)) };
      };

    const auditLog = endpoint('auditLog');

    const rest = {
      orgs: {
        listMembers: endpoint('orgs.listMembers'),
        listOutsideCollaborators: endpoint('orgs.listOutsideCollaborators'),
        getMembershipForUser: endpoint('orgs.getMembershipForUser'),
        removeMembershipForUser: endpoint('orgs.removeMembershipForUser'),
        removeOutsideCollaborator: endpoint('orgs.removeOutsideCollaborator'),
      },
      copilot: {
        listCopilotSeats: endpoint('copilot.listCopilotSeats'),
      },
      issues: {
        listForRepo: endpoint('issues.listForRepo'),
        listCommentsForRepo: endpoint('issues.listCommentsForRepo'),
        listComments: endpoint('issues.listComments'),
        create: endpoint('issues.create'),
        createComment: endpoint('issues.createComment'),
        addLabels: endpoint('issues.addLabels'),
        removeLabel: endpoint('issues.removeLabel'),
        update: endpoint('issues.update'),
      },
      repos: {
        get: endpoint('repos.get'),
        getBranch: endpoint('repos.getBranch'),
        getContent: endpoint('repos.getContent'),
        createOrUpdateFileContents: endpoint(
          'repos.createOrUpdateFileContents',
        ),
      },
      git: {
        getBlob: endpoint('git.getBlob'),
        createRef: endpoint('git.createRef'),
      },
    };

    type Method = (params?: Record<string, any>) => Promise<{ data: any }>;

    const paginate = async (method: Method, params?: Record<string, any>) =>
      (await method(params)).data;

    const iterator = (route: string | Method, params?: Record<string, any>) => {
      const method =
        route === 'GET /orgs/{org}/audit-log'
          ? auditLog
          : typeof route === 'function'
            ? route
            : undefined;

      return (async function* () {
        if (!method) throw new Error(`Unexpected route: ${String(route)}`);
        yield await method(params);
      })();
    };

    return {
      rest,
      paginate: Object.assign(paginate, { iterator }),
    } as unknown as OctokitClient;
  };

  return {
    state,
    client,
    putFile: ({ repo, branch, path }, content) => {
      if (branch !== DEFAULT_BRANCH) state.branches.add(`${repo}@${branch}`);
      state.files.set(fileKey(repo, branch, path), {
        content: JSON.stringify(content, null, 2),
        sha: nextSha(),
      });
    },
    readFile: ({ repo, branch, path }) => {
      const file = state.files.get(fileKey(repo, branch, path));
      return file && JSON.parse(file.content);
    },
    addIssue: (issue) => {
      const created: FakeIssue = {
        number: state.issues.length + 1,
        state: 'open',
        comments: [],
        ...issue,
      };
      state.issues.push(created);
      return created;
    },
    findIssue: (repo, title) =>
      state.issues.find(
        (issue) => issue.repo === repo && issue.title === title,
      ),
    callsTo: (endpoint) =>
      endpoint
        ? state.calls.filter((call) => call.endpoint === endpoint)
        : state.calls,
    writes: () =>
      state.calls.filter((call) => WRITE_ENDPOINTS.includes(call.endpoint)),
  };
};
