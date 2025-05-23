# Copilot Dormancy Check

[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-Copilot%20Dormancy-blue?logo=github)](https://github.com/garnertb/dormant-accounts/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

This GitHub Action identifies dormant GitHub Copilot accounts in your organization, allowing you to manage license utilization effectively. It scans your organization for users who haven't actively used Copilot for a specified period and can automatically notify them or revoke licenses.

## Usage

<!-- start usage -->

```yaml
- uses: garnertb/dormant-accounts/actions/copilot-dormancy@v1
  with:
    # GitHub organization name to check for dormant accounts
    # Default: ${{ github.repository_owner }}
    org: ''

    # The owner and repository name to fetch/store activity logs from (e.g., owner/repo)
    # Default: ${{ github.repository }}
    activity-log-repo: ''

    # Duration of inactivity to consider an account dormant (e.g., 90d, 3m, 1y)
    # Default: 90d
    duration: ''

    # GitHub token with appropriate permissions
    # Default: ${{ github.token }}
    token: ''

    # Run in dry-run mode will not write the activity log
    # Default: false
    dry-run: ''

    # Enable notifications for dormant users
    # Default: false
    notifications-enabled: ''

    # Run in dry-run mode for notifications
    # Default: false
    notifications-dry-run: ''

    # Repository to create notification issues in (e.g., owner/repo)
    # Default: ${{ github.repository }}
    notifications-repo: ''

    # Grace period before removing users after notification (e.g., 7d, 2w, 1m)
    # Default: 7d
    notifications-duration: ''

    # Flag to enable issue assignment for dormant users
    # Default: false
    assign-user-to-notification-issue: ''

    # Remove dormant accounts after the grace period, only if notifications are enabled
    # Default: true
    remove-dormant-accounts: ''

    # Allow removing users from team that assigned Copilot
    # Default: false
    remove-user-from-assigning-team: ''

    # Custom message template for user notifications
    notifications-body: ''
```

<!-- end usage -->

## Required Permissions

To use this action, you'll need:

- A GitHub token with write GitHub Copilot Business scope permissions to access [Copilot Seats API](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps?apiVersion=2022-11-28#organization-permissions-for-github-copilot-business)
- If storing activity logs: `contents: write` permission to the specified repository
- If enabling notifications: `issues: write` permission to create issues in the specified repository

## Outputs

| Name                   | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `dormant-users`        | JSON string containing list of dormant accounts |
| `active-users`         | JSON string containing list of active accounts  |
| `last-activity-fetch`  | Timestamp of when the activity was last fetched |
| `check-stats`          | Statistics about the dormancy check             |
| `notification-results` | Results of the notification process             |
| `error`                | Any errors encountered during the process       |

## Limitations

- This action uses the the `last_activity_at` field from Copilot Billing APIs to determine the last activity date. See GitHub Docs for [Understanding the `last_activity_at` field](https://docs.github.com/en/copilot/managing-copilot/managing-github-copilot-in-your-organization/reviewing-activity-related-to-github-copilot-in-your-organization/reviewing-user-activity-data-for-copilot-in-your-organization#understanding-the-last_activity_at-calculation) for the specifics of how this field is calculated.

## Scenarios

### Basic Usage

```yaml
name: Copilot Dormancy Check
on:
  schedule:
    - cron: '0 0 * * 1' # Runs weekly on Monday at midnight UTC
  workflow_dispatch:

jobs:
  dormancy-check:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      organization-administration: read
    steps:
      - name: Run Copilot Dormancy Check
        uses: garnertb/dormant-accounts/actions/copilot-dormancy@v1
        with:
          duration: '90d' # Consider accounts dormant after 90 days of inactivity
          token: ${{ secrets.ORG_ADMIN_TOKEN }}
```

### With Notifications Enabled

```yaml
name: Copilot Dormancy Check with Notifications
on:
  schedule:
    - cron: '0 0 1 * *' # Runs monthly on the 1st at midnight UTC
  workflow_dispatch:

jobs:
  dormancy-check:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      organization-administration: read
    steps:
      - name: Run Copilot Dormancy Check
        uses: garnertb/dormant-accounts/actions/copilot-dormancy@v1
        with:
          org: 'my-organization'
          duration: '60d' # Consider accounts dormant after 60 days of inactivity
          token: ${{ secrets.ORG_ADMIN_TOKEN }}
          dry-run: 'false'
          notifications-enabled: 'true'
          notifications-repo: 'copilot-notifications'
          notifications-duration: '14d' # Grace period of 14 days
          notifications-body: 'Hello @{{username}}, your GitHub Copilot license has been inactive for {{duration}}. To keep your license, please use Copilot within the next {{gracePeriod}}.'
```

### Process Action Results

```yaml
name: Copilot Dormancy Reporting
on:
  schedule:
    - cron: '0 0 * * 1'
  workflow_dispatch:

jobs:
  dormancy-check:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      organization-administration: read
    outputs:
      dormant-count: ${{ fromJSON(steps.dormancy.outputs.check-stats).dormantCount }}

    steps:
      - name: Run Copilot Dormancy Check
        id: dormancy
        uses: garnertb/dormant-accounts/actions/copilot-dormancy@v1
        with:
          duration: '90d'
          token: ${{ secrets.ORG_ADMIN_TOKEN }}

      - name: Report Results
        if: ${{ fromJSON(steps.dormancy.outputs.check-stats).dormantCount > 0 }}
        run: |
          echo "Found ${{ fromJSON(steps.dormancy.outputs.check-stats).dormantCount }} dormant users"
          echo "Dormant users: ${{ steps.dormancy.outputs.dormant-users }}"
```

## How It Works

1. The action scans your organization for all members with GitHub Copilot licenses
2. It checks the last activity date for each user against the specified duration threshold
3. Users who haven't used Copilot within that timeframe are flagged as dormant
4. If notifications are enabled, issues will be created to notify dormant users
5. Activity logs are stored in the specified repository (if not in dry-run mode)
6. Detailed outputs are provided for further processing or reporting

## License

This project is licensed under the MIT License - see the LICENSE file for details.
