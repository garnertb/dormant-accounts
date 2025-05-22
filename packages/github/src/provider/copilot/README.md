# GitHub Copilot Dormancy Module

This module provides functionality to check for dormant GitHub Copilot users and manage their licenses.

## Components

1. **Dormancy Check** - Configure and run checks for inactive GitHub Copilot users
2. **License Management** - Utilities to revoke Copilot licenses
3. **Account Removal** - Handler for removing dormant users from GitHub Copilot

## Usage

```typescript
import {
  copilotDormancy,
  removeAccount,
} from '@dormant-accounts/github/provider/copilot';
import { Octokit } from '@octokit/rest';

// Initialize Octokit
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Configure dormancy check
const dormancyCheck = copilotDormancy({
  org: 'your-organization',
  octokit,
  inactiveDays: 90,
  // Additional configuration options
});

// Run the dormancy check
const inactiveUsers = await dormancyCheck();

// Process inactive users (e.g., revoke licenses)
for (const user of inactiveUsers) {
  await removeAccount({
    login: user.login,
    octokit,
    org: 'your-organization',
    dryRun: false,
  });
}
```

## API Reference

### `copilotDormancy(config)`

Configures a dormancy check for GitHub Copilot users.

### `removeAccount(options)`

Removes a user's GitHub Copilot license.

### `revokeCopilotLicense(options)`

Low-level function to revoke GitHub Copilot licenses for one or more users.
