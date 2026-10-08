# GitHub Dormancy Check

[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-GitHub%20Dormancy-blue?logo=github)](https://github.com/garnertb/dormant-accounts/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

This GitHub Action finds inactive members of a GitHub organization. It reads activity from the organization audit log and, optionally, from Copilot usage and comments on notification issues. It keeps an activity log in a repository branch, opens a notification issue for each dormant account, and can remove accounts that stay inactive after a grace period.

## Usage

<!-- start usage -->

```yaml
- uses: garnertb/dormant-accounts/actions/github-dormancy@v0.3.0
  with:
    # Organization to check for inactive members
    # Default: ${{ github.repository_owner }}
    org: ''

    # Repository (owner/repo) that stores the activity log on the github-dormancy branch
    # Default: ${{ github.repository }}
    activity-log-repo: ''

    # Inactivity before an account is dormant. Accepts ms durations of at least
    # one day, such as 90d, 90 days, 13w or 1y
    # Default: 90d
    duration: ''

    # Token that reads members, outside collaborators, the audit log and Copilot
    # seats, and removes accounts. It must belong to an organization owner
    # Default: ${{ github.token }}
    token: ''

    # Token with contents write access to activity-log-repo
    # Default: the token input
    activity-log-token: ''

    # Token with issues write access to notifications-repo
    # Default: the token input
    notifications-token: ''

    # Run without saving the activity log, writing to notification issues or
    # removing anyone. Overrides notifications-dry-run and remove-dormant-accounts
    # Default: false
    dry-run: ''

    # Open a notification issue for each dormant account
    # Default: false
    notifications-enabled: ''

    # Report notification actions without writing to issues or removing anyone
    # Default: false
    notifications-dry-run: ''

    # Repository (owner/repo) that holds notification issues
    # Default: ${{ github.repository }}
    notifications-repo: ''

    # Grace period between the notification and removal, at least one day
    # Default: 7d
    notifications-duration: ''

    # Notification issue body template. Supports {{account}}, {{dormantAfter}},
    # {{gracePeriod}}, {{lastActivity}} and {{timeSinceLastActivity}}
    # Default: a message that lists the activity this check counts
    notifications-body: ''

    # Assign each notification issue to the dormant account
    # Default: false
    assign-user-to-notification-issue: ''

    # Remove accounts that are still dormant when the grace period expires.
    # Requires notifications-enabled
    # Default: false
    remove-dormant-accounts: ''

    # Count Copilot usage, including seats pending cancellation, as activity
    # Default: false
    include-copilot-activity: ''

    # How Copilot's last_authenticated_at is used:
    # - ignore: use only last_activity_at
    # - fallback: use last_authenticated_at when last_activity_at is empty
    # - most-recent: use the newer of last_activity_at and last_authenticated_at
    # Default: ignore
    authenticated-at-behavior: ''

    # Count a user's comment on their own open notification issue as activity,
    # even when notifications are disabled
    # Default: false
    count-notification-comments: ''

    # Also check outside collaborators of organization repositories
    # Default: false
    include-outside-collaborators: ''

    # Logins that are always treated as active, separated by commas, spaces or
    # newlines. Matching ignores case
    # Default: ''
    exclude-users: ''

    # Give accounts first seen after the initial run the full duration instead
    # of treating them as dormant
    # Default: true
    first-seen-baseline: ''

    # Proceed when the last saved run is more than 7 days old, beyond the audit
    # log's retention for git events
    # Default: false
    allow-activity-gap: ''
```

<!-- end usage -->

Boolean inputs take `true` or `false`, and other values fail the run. The exception is `notifications-enabled`: any value other than `true` leaves notifications off.

## Required Permissions

| Token                 | Used for                                                                                           | Requirements                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token`               | Listing members and outside collaborators, reading the audit log and Copilot seats, removing users | An organization owner. A personal access token (classic) needs `read:org` and `read:audit_log`, plus `admin:org` when `remove-dormant-accounts` is true. Copilot seats need `manage_billing:copilot` or `read:org` |
| `activity-log-token`  | Reading and writing the activity log                                                               | `contents: write` on `activity-log-repo`                                                                                                                                                                           |
| `notifications-token` | Opening, commenting on, labeling and closing notification issues, and reading their comments       | `issues: write` on `notifications-repo`                                                                                                                                                                            |

The default `github.token` cannot read the audit log, so set `token` to an organization owner's token. When `activity-log-repo` and `notifications-repo` are the workflow's repository, you can pass `${{ github.token }}` as `activity-log-token` and `notifications-token` and grant `contents: write` and `issues: write` in the workflow's `permissions`.

## Outputs

| Name                   | Description                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dormant-users`        | JSON list of activity records for dormant accounts                                                                                                                                                                                                                                                    |
| `active-users`         | JSON list of activity records for active accounts                                                                                                                                                                                                                                                     |
| `last-activity-fetch`  | ISO timestamp of the latest activity fetch                                                                                                                                                                                                                                                            |
| `check-stats`          | JSON summary: `totalAccounts`, `activeAccounts`, `dormantAccounts`, `activeAccountPercentage`, `dormantAccountPercentage`, `duration` and `lastActivityFetch`                                                                                                                                         |
| `notification-results` | JSON object, set when notifications are enabled. `notified`, `inGracePeriod`, `reactivated`, `departed`, `removed`, `skipped`, `wouldRemove` and `excluded` list `{ user, notification }` entries, where `notification` is the issue. `errors` lists `{ user, error }` entries with the error message |
| `error`                | The error that stopped the run, if any                                                                                                                                                                                                                                                                |

## How It Works

1. Lists the accounts in scope: organization members with the `member` role, plus outside collaborators when `include-outside-collaborators` is true. Owners are never checked.
2. Reads activity from each enabled source and keeps each account's newest activity.
3. Merges the activity into the activity log. A newer date replaces a stored one, an account without new activity keeps its stored date, and accounts no longer in scope are dropped.
4. Marks accounts without activity within `duration` as dormant. Logins in `exclude-users` and bot accounts (`[bot]`) are always active.
5. Saves the activity log, unless running in dry-run mode.
6. When notifications are enabled, processes notification issues:
   - Opens an issue for each newly dormant account.
   - Closes issues for accounts that are active again, or that have left scope.
   - Removes accounts whose grace period has expired, when `remove-dormant-accounts` is true.

## Activity Sources

| Source                | Enabled by                    | Activity                                                                                                                                                                                |
| --------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit log             | Always                        | The newest organization audit log event by the account, including git clone, fetch and push events                                                                                      |
| Copilot               | `include-copilot-activity`    | The seat's `last_activity_at`, adjusted by `authenticated-at-behavior`. An unused seat adds no activity, because assigning a seat doesn't count. Seats pending cancellation still count |
| Notification comments | `count-notification-comments` | A comment by the account on its own open notification issue in `notifications-repo`. Only issues with the `github-dormancy` label whose title matches the login, ignoring case, count   |

Use Copilot activity when some members use their GitHub account only for Copilot, for example developers who work on an on-premises server and hold a cloud account just for a Copilot license.

## Activity Log

The action stores `github-dormancy.json` on the `github-dormancy` branch of `activity-log-repo`, and creates the branch on the first save. Each record is keyed by lowercase login:

```json
{
  "_state": {
    "lastRun": "2025-06-15T12:00:00.000Z",
    "check-type": "github-dormancy",
    "lastUpdated": "2025-06-15T12:00:05.000Z",
    "rosterInitializedAt": "2025-06-01T12:00:00.000Z"
  },
  "mona": { "lastActivity": "2025-06-14T09:30:00.000Z", "type": "git.push" },
  "octocat": { "lastActivity": null, "type": "no-activity" }
}
```

### First run

Without a saved log, the first run reads every event the audit log still holds, but the audit log keeps git events for only 7 days. Members without activity in that window are stored with a `null` date and are dormant immediately. To carry history over from an earlier tool, seed the log before the first run:

- Write `github-dormancy.json` to the `github-dormancy` branch. Set `_state.check-type` to `github-dormancy`, and key each `{ "lastActivity": "<ISO date>", "type": "<source>" }` record by lowercase login.
- Set `_state.lastRun` to when the seed data was collected. If that is more than 7 days before the first run, set `allow-activity-gap: true` for that run.
- Leave out `rosterInitializedAt`. The first run then treats members that are missing from the seed and have no activity as dormant, rather than as first seen.

The action keeps seeded dates unless it finds newer activity.

### First-seen baseline

The first run sets `rosterInitializedAt`. After that, an account that appears without a stored record or any activity is stamped with the run time and type `first-seen`, so it gets the full `duration` before it can become dormant. Accounts that leave are dropped from the log, so an account that rejoins starts over. Set `first-seen-baseline: false` to treat new accounts without activity as dormant immediately.

### Run at least weekly

Each run reads the audit log from 7 days before the previous run. If the saved `lastRun` is more than 7 days old, git activity in the gap can no longer be read, and the action fails before writing anything. Set `allow-activity-gap: true` to proceed anyway.

## Notification Issues

Each notification issue is titled with the account's login and mentions the account. The action manages these labels:

| Label             | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `github-dormancy` | Added to every notification issue                                                      |
| `pending-removal` | The account is dormant and inside its grace period                                     |
| `became-active`   | The account was active again, or was added to `exclude-users`, so the issue was closed |
| `departed`        | The account left scope, or was already gone at removal, so the issue was closed        |
| `user-removed`    | The action removed the account and closed the issue                                    |
| `admin-exclusion` | Add this label to keep the issue open without removing the account                     |

Before removing an account, the action re-reads its state:

- It skips the removal when the user has commented on the notification issue, or when the comments cannot be read.
- It skips owners, and closes their issue as `departed` on the next run.
- It removes members with the membership endpoint and outside collaborators with the outside collaborator endpoint.
- It closes the issue as `departed` when the account is no longer in the organization.

A skipped removal leaves the issue open and is reported in `notification-results`.

## Safety

- **Fails closed:** the action fails before saving, notifying or removing anything when listing members or outside collaborators fails, when the member list is empty, when any enabled activity source fails, or when an existing activity log cannot be read.
- **Saves first:** the activity log is saved before notifications are processed, and a failed save stops the run.
- **Dry run:** `dry-run: true` reads activity and reports who would be notified and removed. It never saves the log, writes to issues or removes accounts, whatever `notifications-dry-run` and `remove-dormant-accounts` are set to. Its counts match a real run.

## Limitations

- The organization audit log API is available on GitHub Enterprise Cloud, and only to organization owners.
- Activity that creates no organization audit log event, such as browsing repositories or working outside the organization, does not count.
- The audit log API allows 1,750 queries per hour per user and IP address. Each run reads every event since 7 days before the previous run, 100 events per page.
- Copilot activity uses the `last_activity_at` field from the Copilot seats API. See [Understanding the `last_activity_at` calculation](https://docs.github.com/en/copilot/managing-copilot/managing-github-copilot-in-your-organization/reviewing-activity-related-to-github-copilot-in-your-organization/reviewing-user-activity-data-for-copilot-in-your-organization#understanding-the-last_activity_at-calculation).

## Scenarios

### Report Only

```yaml
name: GitHub Dormancy Check
on:
  schedule:
    - cron: '0 6 * * *' # Daily, well inside the audit log's 7-day git retention
  workflow_dispatch:

permissions:
  contents: write

jobs:
  dormancy-check:
    runs-on: ubuntu-latest
    steps:
      - uses: garnertb/dormant-accounts/actions/github-dormancy@v0.3.0
        with:
          token: ${{ secrets.ORG_OWNER_TOKEN }}
          activity-log-token: ${{ github.token }}
```

### Notify, Then Remove

```yaml
name: GitHub Dormancy Check
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

permissions:
  contents: write
  issues: write

jobs:
  dormancy-check:
    runs-on: ubuntu-latest
    steps:
      - uses: garnertb/dormant-accounts/actions/github-dormancy@v0.3.0
        with:
          token: ${{ secrets.ORG_OWNER_TOKEN }}
          activity-log-token: ${{ github.token }}
          notifications-token: ${{ github.token }}
          duration: '90d'
          notifications-enabled: 'true'
          notifications-duration: '14d'
          count-notification-comments: 'true'
          remove-dormant-accounts: 'true'
          exclude-users: |
            service-account
            break-glass-admin
```

### Count Copilot Usage as Activity

```yaml
- uses: garnertb/dormant-accounts/actions/github-dormancy@v0.3.0
  with:
    token: ${{ secrets.ORG_OWNER_TOKEN }}
    duration: '90 days'
    include-copilot-activity: 'true'
    notifications-enabled: 'true'
    count-notification-comments: 'true'
```

### Preview With Dry Run

```yaml
- uses: garnertb/dormant-accounts/actions/github-dormancy@v0.3.0
  with:
    token: ${{ secrets.ORG_OWNER_TOKEN }}
    dry-run: 'true'
    notifications-enabled: 'true'
    remove-dormant-accounts: 'true'
```

### Process Action Results

```yaml
- name: Run GitHub Dormancy Check
  id: dormancy
  uses: garnertb/dormant-accounts/actions/github-dormancy@v0.3.0
  with:
    token: ${{ secrets.ORG_OWNER_TOKEN }}

- name: Report Results
  if: ${{ fromJSON(steps.dormancy.outputs.check-stats).dormantAccounts > 0 }}
  run: |
    echo "Found ${{ fromJSON(steps.dormancy.outputs.check-stats).dormantAccounts }} dormant accounts"
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
