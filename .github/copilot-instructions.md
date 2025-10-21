# Dormant Accounts Monorepo

## Project Overview

This is a **Turborepo monorepo** for tracking user activity and managing dormant accounts across services. The primary use case is managing GitHub Copilot license allocation by automatically identifying and notifying users with inactive Copilot usage.

### Architecture

**Core Library** (`packages/dormant-accounts/`):

- Service-agnostic dormancy tracking engine using `DormantAccountCheck` class
- JSON-based database (`lowdb`) for activity state persistence (e.g., `github-copilot-dormancy.json`)
- Extensible via configuration: custom `fetchLatestActivity`, `isDormant`, and `isWhitelisted` handlers
- Activity results can be `partial` (incremental updates) or `complete` (full snapshots)

**GitHub Provider** (`packages/github/`):

- GitHub-specific implementation with Copilot dormancy support (`packages/github/src/provider/copilot/`)
- `GithubIssueNotifier`: Creates GitHub issues to notify dormant users with grace periods
- Uses GitHub Audit Log API and Copilot Billing API (`last_activity_at` field)
- Supports team-based Copilot assignment detection and IDP-synced team handling

**GitHub Action** (`actions/copilot-dormancy/`):

- Reusable workflow for GitHub organizations for tracking GitHub Copilot dormancy
- Stores activity logs in Git (via branches: `copilot-dormancy`)
- Notification workflow: create issue → grace period → remove license if not reactivated
- Uses `@vercel/ncc` to bundle dependencies into single `dist/index.js`

## Development Workflow

### Package Management

- Use **`pnpm`** exclusively (enforced by workspace config)
- Workspace packages defined in `pnpm-workspace.yaml`: `packages/*`, `actions/*`, `examples/*`, `tooling/*`
- Internal dependencies use `workspace:*` protocol

### Build & Dev Commands

```bash
pnpm build          # Build all packages (required before test/lint)
pnpm dev            # Watch mode for all packages except examples
pnpm examples       # Run example implementations
pnpm test           # Run vitest tests across workspace
pnpm lint           # ESLint with --max-warnings=0
```

**Important**: Turbo caches builds. Always run `pnpm build` before testing after dependency changes.

### Testing Conventions

- Use **vitest** for all tests (`.test.ts` files alongside source)
- **Do NOT test logging statements** (per project standards)
- For GitHub API pagination: Use `octokit.paginate()` interface (see `.github/instructions/ts.instructions.md`)

### Changesets for Versioning

- Use `@changesets/cli` for version management
- Run `pnpm version-packages` to consume changesets and update versions
- Run `pnpm release` to publish packages (builds first)

## Code Patterns & Conventions

### TypeScript Standards

- Functional programming preferred over classes (except `DormantAccountCheck` and `Database`)
- Use `type-fest` utilities like `SetRequired`, `RequireAllOrNone` for precise types
- TSDoc comments required for all public APIs with parameter/return types
- Prefer destructuring, optional chaining (`?.`), nullish coalescing (`??`)

### Duration Strings

- Use `ms` package format: `'90d'`, `'3m'`, `'1y'` (see `packages/dormant-accounts/src/types.ts`)
- Convert via `durationToMillis()` utility

### Activity Records Structure

```typescript
type LastActivityRecord = {
  login: string; // User identifier
  lastActivity: Date | null; // null = no activity ever
  type: string; // Activity type (e.g., 'copilot-usage')
  metadata?: Record<string, unknown>; // Optional contextual data
};
```

### Notification Template Variables

Notification bodies support Mustache-style variables (see `packages/github/src/provider/templateHandler.ts`):

- `{{lastActivity}}` - Formatted date of last activity
- `{{gracePeriod}}` - Human-readable grace period
- `{{dormantAfter}}` - Duration threshold for dormancy
- Access record metadata: `{{metadata.teamName}}`

### Database Pattern

Each dormancy check maintains a JSON file database with:

```json
{
  "_state": {
    "lastRun": "2024-10-21T12:00:00Z",
    "check-type": "github-copilot-dormancy",
    "lastUpdated": "2024-10-21T12:00:00Z"
  },
  "username1": { "lastActivity": "...", "type": "..." },
  "username2": { "lastActivity": null, "type": "..." }
}
```

## Key Files to Reference

- `packages/dormant-accounts/src/index.ts` - Core `DormantAccountCheck` implementation
- `packages/github/src/provider/copilot/dormancy.ts` - Copilot-specific configuration
- `packages/github/src/provider/notifier.ts` - GitHub issue notification workflow
- `actions/copilot-dormancy/src/run.ts` - GitHub Action orchestration logic
- `.github/instructions/*.instructions.md` - File-specific coding rules (auto-applied)
