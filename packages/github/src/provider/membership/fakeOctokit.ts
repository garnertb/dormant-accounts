import { vi, type Mock } from 'vitest';

/**
 * Error shaped like an Octokit request error
 */
export const httpError = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

export interface FakeIssue {
  number: number;
  title: string;
  created_at: string;
  labels: string[];
  state?: 'open' | 'closed';
  pull_request?: object;
}

export interface FakeRepoComment {
  issue_number: number;
  login: string;
  created_at: string;
}

export type FakeFailure =
  | 'members'
  | 'outsideCollaborators'
  | 'audit'
  | 'copilot'
  | 'issues'
  | 'repoComments'
  | 'issueComments';

export interface FakeOctokitData {
  members?: string[];
  outsideCollaborators?: string[];
  auditEntries?: Array<{
    actor: string;
    action?: string;
    '@timestamp': number | string;
  }>;
  seats?: Array<Record<string, unknown>>;
  issues?: FakeIssue[];
  repoComments?: FakeRepoComment[];
  issueComments?: Record<number, string[]>;
  memberships?: Record<string, { role: string; state: string } | Error>;
  failures?: Partial<Record<FakeFailure, unknown>>;
}

type Params = Record<string, any>;

/**
 * In-memory Octokit double returned by {@link createFakeOctokit}
 */
export interface FakeOctokit {
  rest: {
    orgs: Record<
      | 'listMembers'
      | 'listOutsideCollaborators'
      | 'getMembershipForUser'
      | 'removeMembershipForUser'
      | 'removeOutsideCollaborator',
      Mock
    >;
    copilot: { listCopilotSeats: Mock };
    issues: Record<
      'listForRepo' | 'listCommentsForRepo' | 'listComments',
      Mock
    >;
  };
  paginate: Mock<(method: unknown, params?: Params) => Promise<unknown[]>> & {
    iterator: Mock<
      (route: unknown, params?: Params) => AsyncGenerator<{ data: unknown }>
    >;
  };
}

/**
 * Creates an in-memory Octokit double covering the endpoints used by the
 * membership dormancy check
 */
export const createFakeOctokit = (data: FakeOctokitData = {}): FakeOctokit => {
  const fail = (key: FakeFailure) => {
    if (data.failures?.[key]) throw data.failures[key];
  };

  const rest = {
    orgs: {
      listMembers: vi.fn(),
      listOutsideCollaborators: vi.fn(),
      getMembershipForUser: vi.fn(
        async ({ username }: { username: string }) => {
          const membership = data.memberships?.[username.toLowerCase()];
          if (!membership) throw httpError(404, 'Not Found');
          if (membership instanceof Error) throw membership;
          return { data: membership };
        },
      ),
      removeMembershipForUser: vi.fn(async () => ({ status: 204 })),
      removeOutsideCollaborator: vi.fn(async () => ({ status: 204 })),
    },
    copilot: { listCopilotSeats: vi.fn() },
    issues: {
      listForRepo: vi.fn(),
      listCommentsForRepo: vi.fn(),
      listComments: vi.fn(),
    },
  };

  const paginate = vi.fn(
    async (method: unknown, params: Params = {}): Promise<unknown[]> => {
      switch (method) {
        case rest.orgs.listMembers:
          fail('members');
          return (data.members ?? []).map((login) => ({ login }));
        case rest.orgs.listOutsideCollaborators:
          fail('outsideCollaborators');
          return (data.outsideCollaborators ?? []).map((login) => ({ login }));
        case rest.issues.listForRepo: {
          fail('issues');
          const labels: string[] = params.labels
            ? params.labels.split(',')
            : [];
          return (data.issues ?? [])
            .filter(
              (issue) =>
                (!params.state || (issue.state ?? 'open') === params.state) &&
                labels.every((label) => issue.labels.includes(label)),
            )
            .map((issue) => ({
              ...issue,
              state: issue.state ?? 'open',
              labels: issue.labels.map((name) => ({ name })),
            }));
        }
        case rest.issues.listCommentsForRepo:
          fail('repoComments');
          return (data.repoComments ?? [])
            .filter(
              (comment) =>
                !params.since ||
                Date.parse(comment.created_at) >= Date.parse(params.since),
            )
            .map((comment) => ({
              issue_url: `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${comment.issue_number}`,
              user: { login: comment.login },
              created_at: comment.created_at,
            }));
        case rest.issues.listComments:
          fail('issueComments');
          return (data.issueComments?.[params.issue_number] ?? []).map(
            (login) => ({ user: { login } }),
          );
        default:
          throw new Error('Unexpected paginate call');
      }
    },
  );

  const iterator: FakeOctokit['paginate']['iterator'] = vi.fn((route) => {
    if (route === 'GET /orgs/{org}/audit-log') {
      return (async function* () {
        fail('audit');
        yield { data: data.auditEntries ?? [] };
      })();
    }

    if (route === rest.copilot.listCopilotSeats) {
      return (async function* () {
        fail('copilot');
        yield {
          data: { seats: data.seats ?? [], total_seats: data.seats?.length },
        };
      })();
    }

    throw new Error('Unexpected iterator call');
  });

  return { rest, paginate: Object.assign(paginate, { iterator }) };
};
