---
'@dormant-accounts/copilpot-dormancy-action': minor
---

Fix dry run, notification and activity log handling:

- `dry-run` now forces `notifications-dry-run` and disables removal.
- Existing notification issues are found when more than 50 are open.
- A removal that returns false leaves the issue open and is reported as `skipped`, not `removed`. Dry runs report `wouldRemove` instead.
- `notification-results` and the job summary include the `departed`, `skipped` and `wouldRemove` lists.
- Activity logs are read as raw blobs, so logs over 1 MB load. A log that exists but can't be read now fails the run instead of starting a new log.
- Records for Copilot seats that report no editor, such as unused seats, now have the type `unknown_editor` instead of `null`.
