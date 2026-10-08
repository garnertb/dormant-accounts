---
'dormant-accounts': minor
---

Add an `activityMergeStrategy: 'latest'` option. It lowercases and dedupes logins, keeps each account's newest activity date, never replaces a date with `null`, and saves records, pruning and `lastRun` in one database write. It can't be combined with a custom `logActivityForUser`.

Add an opt-in `firstSeenBaseline` option for complete results. The first run records accounts with no activity as `null`. Later runs record a newly seen account as `first-seen` at the fetch time, so it gets the full dormancy threshold.

Dry runs now prune departed accounts from the working copy for complete results, so their counts match a real run.
