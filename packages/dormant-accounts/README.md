# Dormant Accounts

A library for tracking user activity and identifying dormant accounts across various services.

## Installation

```bash
npm install dormant-accounts
# or
yarn add dormant-accounts
# or
pnpm add dormant-accounts
```

## Overview

This library helps you track user activity and identify dormant accounts based on configurable inactivity thresholds. It's designed to be service-agnostic and can be extended to work with any system where you need to monitor user activity.

## Basic Usage

```typescript
import { dormancyCheck } from 'dormant-accounts';

// Create a dormancy checker with basic configuration
const dormantUsers = dormancyCheck({
  type: 'github',
  duration: '90d', // Consider accounts dormant after 90 days of inactivity
  fetchLatestActivity: async ({ lastFetchTime }) => {
    // Implement your logic to fetch user activity records
    // Return an array of acttivity records per account
    return [
      {
        login: 'user1',
        lastActivity: new Date('2023-01-15'),
        // Optional additional data
        type: 'commit',
      },
      // More records...
    ];
  },
});

await dormantUsers.fetchActivity(); // Fetches and stores latest activity data
```

## Advanced Configuration

The library supports advanced configurations including custom dormancy checks, whitelists, and activity logging:

```typescript
import { dormancyCheck } from 'dormant-accounts';

// Extended configuration type
type GitHubConfig = {
  organizationName: string;
  minimumCommits: number;
};

const checker = dormancyCheck<GitHubConfig>({
  type: 'github',
  duration: '60d',
  conf: {
    organizationName: 'myorg',
    minimumCommits: 5,
  },

  // Custom activity fetcher
  fetchLatestActivity: async ({ lastFetchTime, organizationName, logger }) => {
    logger.info(
      `Fetching activity for ${organizationName} since ${lastFetchTime}`,
    );
    // Implement custom fetching logic
    return [
      /* activity records */
    ];
  },

  // Custom dormancy checker
  isDormant: async ({
    login,
    lastActivity,
    duration,
    minimumCommits,
    logger,
  }) => {
    // You can implement more complex dormancy checks
    const durationCheck =
      !lastActivity ||
      new Date().getTime() - lastActivity.getTime() >
        durationToMillis(duration);

    // Consider additional factors
    const commitCheck = (metadata?.commitCount || 0) < minimumCommits;

    return durationCheck && commitCheck;
  },

  // Custom whitelist checker
  isWhitelisted: async ({ login }) => {
    // Implement logic to check if users should be exempt from dormancy checks
    return ['admin', 'service-account'].includes(login);
  },
});
```

## API Reference

### `dormancyCheck(config)`

Creates a new dormancy checker with the provided configuration.

#### Configuration Options

| Option                | Type       | Required | Description                                                                            |
| --------------------- | ---------- | -------- | -------------------------------------------------------------------------------------- |
| `type`                | `string`   | Yes      | Identifier for the type of dormancy check                                              |
| `duration`            | `string`   | No       | Duration string (e.g., '90d', '3m', '1y') to consider accounts dormant. Default: '30d' |
| `dryRun`              | `boolean`  | No       | When true, doesn't perform any destructive actions                                     |
| `dbPath`              | `string`   | No       | Custom path for the database file                                                      |
| `fetchLatestActivity` | `Function` | Yes      | Function to fetch latest user activity records                                         |
| `isDormant`           | `Function` | No       | Custom function to determine if an account is dormant                                  |
| `isWhitelisted`       | `Function` | No       | Function to determine if an account should be exempt from dormancy checks              |
| `logActivityForUser`  | `Function` | No       | Custom function to record user activity                                                |
| `conf`                | `T`        | No       | Extended configuration specific to your implementation                                 |

### Methods

| Method                                | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `fetchActivity(lastFetchTime?: Date)` | Fetches and stores latest activity data        |
| `listAccounts()`                      | Returns all tracked accounts                   |
| `listActiveAccounts()`                | Returns accounts considered active             |
| `listDormantAccounts()`               | Returns accounts considered dormant            |
| `summarize()`                         | Generates a summary report of account statuses |
| `getDatabaseData()`                   | Returns the raw database content               |

## Integration with GitHub Actions

This library can be used with the `copilot-dormancy` GitHub Action to automate dormancy checks in your organization:

```yaml
name: Check GitHub Copilot Dormancy

on:
  schedule:
    - cron: '0 0 * * 1' # Run weekly on Mondays
  workflow_dispatch: # Allow manual triggering

jobs:
  check-dormancy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write

    steps:
      - name: Check Copilot dormant accounts
        uses: garnertb/dormant-accounts/actions/copilot-dormancy@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          duration: '90d'
          dry-run: 'false'
          notifications-enabled: 'true'
          notifications-duration: '14d'
```

## License

MIT
