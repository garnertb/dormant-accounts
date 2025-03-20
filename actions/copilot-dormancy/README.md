# GitHub Copilot Dormancy Check Action

This GitHub Action identifies dormant GitHub Copilot accounts in your organization, allowing you to manage license utilization effectively. The action scans your organization for Copilot users who haven't been active for a specified period and provides detailed reports.

## Features

- 📊 Identifies dormant GitHub Copilot users based on configurable inactivity thresholds
- 📝 Logs user activity data for auditing and tracking
- 🔄 Can be run on a schedule or manually triggered
- 🚫 Supports optional notifications to dormant users (via a configurable grace period)
- ⚙️ Highly configurable with sensible defaults

## Required Permissions

To use this action, you'll need:

- A GitHub token with `admin:org` permissions to view organization members and their Copilot usage
- If storing activity logs: write permissions to the specified repository
- If enabling notifications: write permissions to create issues in the specified repository

## Inputs

| Name                     | Description                                                               | Required | Default                          |
| ------------------------ | ------------------------------------------------------------------------- | -------- | -------------------------------- |
| `org`                    | GitHub organization name to check for dormant accounts                    | No       | `${{ github.repository_owner }}` |
| `activity-log-repo`      | Repository to store activity logs                                         | No       | `${{ github.repository }}`       |
| `duration`               | Duration of inactivity to consider an account dormant (e.g., 90d, 3m, 1y) | No       | `90d`                            |
| `token`                  | GitHub token with appropriate permissions                                 | No       | `${{ github.token }}`            |
| `dry-run`                | Run in dry-run mode without making any changes                            | No       | `true`                           |
| `notifications-enabled`  | Enable notifications for dormant users                                    | No       | `false`                          |
| `notifications-repo-org` | Organization that owns the repository for notifications                   | No       | `${{ github.repository_owner }}` |
| `notifications-repo`     | Repository to create notification issues in                               | No       | `${{ github.repository }}`       |
| `notifications-duration` | Grace period before removing users after notification (e.g., 7d, 2w, 1m)  | No       | `7d`                             |
| `notifications-body`     | Custom message template for user notifications                            | No       | Template message                 |

## Outputs

| Name                   | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `dormant-users`        | JSON string containing list of dormant accounts |
| `active-users`         | JSON string containing list of active accounts  |
| `last-activity-fetch`  | Timestamp of when the activity was last fetched |
| `check-stats`          | Statistics about the dormancy check             |
| `notification-results` | Results of the notification process             |
| `error`                | Any errors encountered during the process       |

## Usage Examples

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
          duration: '90d'
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
          duration: '60d'
          token: ${{ secrets.ORG_ADMIN_TOKEN }}
          dry-run: 'false'
          notifications-enabled: 'true'
          notifications-repo: 'copilot-notifications'
          notifications-duration: '14d'
          notifications-body: 'Hello @{{username}}, your GitHub Copilot license has been inactive for {{duration}}. To keep your license, please use Copilot within the next {{gracePeriod}}.'
```

### Output Usage Example

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
2. It checks the activity date for each user against the specified duration threshold
3. Users who haven't used Copilot within that timeframe are flagged as dormant
4. If notifications are enabled, issues will be created to notify dormant users
5. Activity logs are stored in the specified repository (if not in dry-run mode)
6. Detailed outputs are provided for further processing or reporting

## Best Practices

- Start with `dry-run: 'true'` to review results before making any changes
- Use a dedicated service account with appropriate permissions
- Store sensitive tokens as GitHub secrets
- When enabling notifications, use a clear and friendly message to users
- Consider setting up a secondary workflow that acts on the outputs of this action for custom reporting

## License

This project is licensed under the MIT License - see the LICENSE file for details.
