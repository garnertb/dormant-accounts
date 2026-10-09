---
'@dormant-accounts/github': minor
---

Add the `githubMembershipDormancy` check for organization members, and optionally outside collaborators. It reads activity from the audit log and, when enabled, from Copilot seats and from users' comments on their own notification issues. Audit log actions that GitHub records for a user without the user doing anything don't count: `ignoreAuditActions` defaults to `DEFAULT_IGNORED_AUDIT_ACTIONS` (`org_credential_authorization.deauthorize`). It fails before saving anything when a source errors, the member list is empty, or more than 7 days have passed since the last run without `allowActivityGap`.

Add a `removeOrgMember` handler that re-checks membership and the notification issue's comments before removing a member, and export `defaultWhitelistHandler`.

`GithubIssueNotifier` changes:

- Finds existing notifications in its open-issue listing instead of a search capped at 50 results.
- Closes notifications for accounts outside an optional in-scope set with a `departed` label.
- Passes the notification issue to `removeAccount` and accepts `removed`, `already-absent` and `skipped` results as well as booleans.
- Reports an account as removed only after a successful removal, and as `wouldRemove` in dry run.
