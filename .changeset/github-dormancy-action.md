---
'@dormant-accounts/github-dormancy-action': minor
---

Add the `github-dormancy` action. It finds organization members with no recent activity in the audit log, can also count Copilot usage and comments on notification issues as activity, notifies dormant members through issues, and can remove them after a grace period. By default it ignores `org_credential_authorization.deauthorize` audit log events, which GitHub records when it removes a member's SAML credential authorization; `ignore-audit-actions` sets the list, and `none` counts every event.
