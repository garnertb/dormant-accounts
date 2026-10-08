import { getOctokit } from '@actions/github';
import {
  compareDatesAgainstDuration,
  enrichLastActivityRecord,
} from 'dormant-accounts/utils';
import { LastActivityRecord } from 'dormant-accounts';
import { getNotifications } from './getNotifications';
import { NotificationIssue } from './getExistingNotification';
import {
  NotificationBodyHandler,
  createDefaultNotificationBodyHandler,
} from './templateHandler';

/**
 * Status labels for notification issues
 */
export enum NotificationStatus {
  ACTIVE = 'became-active',
  EXCLUDED = 'admin-exclusion',
  PENDING = 'pending-removal',
  REMOVED = 'user-removed',
  DEPARTED = 'departed',
}

/**
 * Configuration for the notification system
 */
export interface NotificationConfig {
  dormantAfter?: string;
  gracePeriod: string; // e.g. '7d', '30d'
  notificationBody: string | NotificationBodyHandler;
  repository: {
    owner: string;
    repo: string;
    baseLabels: string[];
  };
  githubClient: ReturnType<typeof getOctokit>; // Octokit client instance
  dryRun?: boolean; // Optional flag for running without making changes
  assignUserToIssue?: boolean; // Optional flag to assign user to the issue
  removeAccount?: RemoveAccountHandler; // Optional handler for account removal
}

/**
 * Outcome of an account removal attempt.
 *
 * - `removed`: the account was removed; the notification is closed as removed
 * - `already-absent`: the account was already gone; the notification is closed as departed
 * - `skipped`: the account was not removed; the notification stays open
 */
export type RemoveAccountOutcome = 'removed' | 'already-absent' | 'skipped';

/**
 * Context passed to a {@link RemoveAccountHandler}
 */
export interface RemoveAccountContext {
  lastActivityRecord: LastActivityRecord;
  notification: NotificationIssue;
}

/**
 * Handler function type for account removal. A boolean result is accepted for
 * backwards compatibility: `true` means `removed`, `false` means `skipped`.
 */
export type RemoveAccountHandler = (
  context: RemoveAccountContext,
) => Promise<boolean | RemoveAccountOutcome>;

/**
 * A user and the notification issue associated with them
 */
export interface NotificationEntry {
  user: string;
  notification: NotificationIssue;
}

/**
 * Results from processing dormant users
 */
export interface ProcessingResult {
  notified: NotificationEntry[];
  /** Accounts removed by the removal handler */
  removed: NotificationEntry[];
  reactivated: NotificationEntry[];
  excluded: NotificationEntry[];
  inGracePeriod: NotificationEntry[];
  /** Notifications closed because the account left scope or was already gone */
  departed: NotificationEntry[];
  /** Expired notifications left open because the removal handler skipped the account */
  skipped: NotificationEntry[];
  /** Dry run only: expired notifications whose accounts would be removed */
  wouldRemove: NotificationEntry[];
  errors: Array<{ user: string; error: Error }>;
}

/**
 * Options for {@link DormantAccountNotifier.processDormantUsers}
 */
export interface ProcessDormantUsersOptions {
  /**
   * Every login currently covered by the check. When provided, open
   * notifications for logins outside this set are closed as departed instead
   * of reactivated. Compared case-insensitively.
   */
  inScopeLogins?: Iterable<string>;
}

/**
 * Main notification service interface
 */
export interface DormantAccountNotifier {
  processDormantUsers(
    users: LastActivityRecord[],
    options?: ProcessDormantUsersOptions,
  ): Promise<ProcessingResult>;
  findReactivatedUsers(
    currentDormantUsers: LastActivityRecord[],
    inScopeLogins?: Iterable<string>,
  ): Promise<string[]>;
  notifyUser(user: LastActivityRecord): Promise<NotificationIssue>;
  hasGracePeriodExpired(notification: NotificationIssue): boolean;
  removeAccount(
    user: LastActivityRecord,
    notification: NotificationIssue,
  ): Promise<RemoveAccountOutcome>;
  closeNotificationForActiveUser(
    user: LastActivityRecord,
    notification: NotificationIssue,
  ): Promise<void>;
  closeNotificationForDepartedUser(
    user: Pick<LastActivityRecord, 'login'>,
    notification: NotificationIssue,
  ): Promise<void>;
  markAdminExclusion(
    user: LastActivityRecord,
    notification: NotificationIssue,
    reason: string,
  ): Promise<void>;
  getNotificationsByStatus(
    status: NotificationStatus,
  ): Promise<Array<{ user: string; notification: NotificationIssue }>>;
}

/**
 * Implementation of DormantAccountNotifier using GitHub Issues
 */
export class GithubIssueNotifier implements DormantAccountNotifier {
  private config!: NotificationConfig;
  private octokit!: ReturnType<typeof getOctokit>;

  /**
   * Initialize the notifier with configuration
   */
  constructor(config: NotificationConfig) {
    this.config = config;
    this.octokit = config.githubClient;
  }

  /**
   * Process a list of dormant users.
   *
   * Existing notifications are matched to users by issue title, compared
   * case-insensitively, from a single paginated listing of open notification
   * issues. Open notifications for users who are no longer dormant are closed
   * as reactivated, or as departed when `inScopeLogins` is provided and the
   * user is no longer in scope.
   *
   * @param users - Accounts currently considered dormant
   * @param options - Optional processing options
   * @returns Users grouped by the action taken
   */
  async processDormantUsers(
    users: LastActivityRecord[],
    options: ProcessDormantUsersOptions = {},
  ): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      notified: [],
      removed: [],
      reactivated: [],
      excluded: [],
      inGracePeriod: [],
      departed: [],
      skipped: [],
      wouldRemove: [],
      errors: [],
    };

    const openNotifications = await this.getOpenNotificationsByLogin();
    const dormantLogins = new Set(
      users.map((user) => user.login.toLowerCase()),
    );
    const inScopeLogins = toLowercaseSet(options.inScopeLogins);
    const removalResults: Record<RemoveAccountOutcome, NotificationEntry[]> = {
      removed: result.removed,
      'already-absent': result.departed,
      skipped: result.skipped,
    };

    for (const user of users) {
      try {
        const notification = openNotifications.get(user.login.toLowerCase());

        if (notification) {
          if (this.hasLabel(notification, NotificationStatus.EXCLUDED)) {
            result.excluded.push({ user: user.login, notification });
            continue;
          }

          if (!this.hasGracePeriodExpired(notification)) {
            result.inGracePeriod.push({ user: user.login, notification });
            continue;
          }

          if (this.config.dryRun) {
            console.log(`[DRY RUN] Would remove account: ${user.login}`);
            result.wouldRemove.push({ user: user.login, notification });
            continue;
          }

          const outcome = await this.removeAccount(user, notification);
          removalResults[outcome].push({ user: user.login, notification });
        } else if (!this.config.dryRun) {
          const newNotification = await this.notifyUser(user);
          result.notified.push({
            user: user.login,
            notification: newNotification,
          });
        } else {
          console.log(`[DRY RUN] Would notify user: ${user.login}`);
          result.notified.push({
            user: user.login,
            // @ts-ignore
            notification: {
              id: 0,
              number: 0,
              title: user.login,
              created_at: new Date().toISOString(),
              labels: [],
              state: 'open',
            },
          });
        }
      } catch (error) {
        result.errors.push({ user: user.login, error: error as Error });
      }
    }

    for (const [login, notification] of openNotifications) {
      if (dormantLogins.has(login)) {
        continue;
      }

      const user = { login: notification.title };
      const departed = inScopeLogins !== undefined && !inScopeLogins.has(login);

      try {
        if (departed) {
          if (!this.config.dryRun) {
            await this.closeNotificationForDepartedUser(user, notification);
          }
          result.departed.push({ user: user.login, notification });
        } else {
          if (!this.config.dryRun) {
            await this.closeNotificationForActiveUser(user, notification);
          }
          result.reactivated.push({ user: user.login, notification });
        }
      } catch (error) {
        result.errors.push({ user: user.login, error: error as Error });
      }
    }

    return result;
  }

  /**
   * Find users who have open notifications but are no longer dormant
   *
   * @param currentDormantUsers - Accounts currently considered dormant
   * @param inScopeLogins - Optional set of logins covered by the check; when
   * provided, logins outside the set are excluded from the result
   * @returns Notification issue titles for reactivated users
   */
  async findReactivatedUsers(
    currentDormantUsers: LastActivityRecord[],
    inScopeLogins?: Iterable<string>,
  ): Promise<string[]> {
    const dormantLogins = new Set(
      currentDormantUsers.map((user) => user.login.toLowerCase()),
    );
    const inScope = toLowercaseSet(inScopeLogins);
    const openNotifications = await this.getOpenNotificationsByLogin();

    return [...openNotifications]
      .filter(
        ([login]) =>
          !dormantLogins.has(login) && (!inScope || inScope.has(login)),
      )
      .map(([, notification]) => notification.title);
  }

  /**
   * Create a notification for a user
   */
  async notifyUser(user: LastActivityRecord): Promise<NotificationIssue> {
    console.log(`Creating notification for ${user.login}`);
    const notificationContext = {
      lastActivityRecord: enrichLastActivityRecord(user),
      gracePeriod: this.config.gracePeriod,
      dormantAfter: this.config.dormantAfter,
    };
    // Generate notification body based on whether it's a string or function
    const notificationBody =
      typeof this.config.notificationBody === 'function'
        ? this.config.notificationBody(notificationContext)
        : createDefaultNotificationBodyHandler(this.config.notificationBody)(
            notificationContext,
          );

    const { data } = await this.octokit.rest.issues.create({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      title: user.login,
      body: `@${user.login}\n\n${notificationBody}`,
      labels: [
        ...this.config.repository.baseLabels,
        NotificationStatus.PENDING,
      ],
      assignees: this.config.assignUserToIssue ? [user.login] : undefined,
    });

    console.log(`Notification created for ${user.login}`);
    return data;
  }

  /**
   * Check if notification grace period has expired
   */
  hasGracePeriodExpired(
    notification: Pick<NotificationIssue, 'created_at'>,
  ): boolean {
    return compareDatesAgainstDuration(
      this.config.gracePeriod,
      new Date(notification.created_at),
    ).overDuration;
  }

  /**
   * Remove a user after grace period expiration.
   *
   * The configured removal handler decides the outcome. `removed` closes the
   * notification as removed, `already-absent` closes it as departed, and
   * `skipped` (or `false`) leaves it open. Handler errors are rethrown and
   * leave the notification open. Without a handler the notification is closed
   * as removed.
   *
   * @param user - The dormant account
   * @param notification - The account's open notification issue
   * @returns The removal outcome
   */
  async removeAccount(
    user: LastActivityRecord,
    notification: NotificationIssue,
  ): Promise<RemoveAccountOutcome> {
    console.log(`Removing account ${user.login}`);

    let outcome: RemoveAccountOutcome = 'removed';

    if (this.config.removeAccount) {
      try {
        outcome = normalizeRemoveAccountOutcome(
          await this.config.removeAccount({
            lastActivityRecord: user,
            notification,
          }),
        );
        console.log(
          `Account removal handler executed for ${user.login}: ${outcome}`,
        );
      } catch (error) {
        console.error(
          `Error executing account removal handler for ${user.login}:`,
          error,
        );
        throw error;
      }
    } else {
      console.log(`No account removal handler provided for ${user.login}`);
    }

    if (outcome === 'skipped') {
      console.warn(
        `Account ${user.login} was not removed; leaving notification #${notification.number} open`,
      );
      return outcome;
    }

    if (outcome === 'already-absent') {
      await this.closeNotificationForDepartedUser(user, notification);
      return outcome;
    }

    // Add comment and label before closing
    await this.addCommentToIssue(
      notification.number,
      `Account ${user.login} removed due to inactivity after ${this.config.gracePeriod} grace period.`,
    );

    await this.addLabelToIssue(notification.number, NotificationStatus.REMOVED);

    // Close the issue
    await this.octokit.rest.issues.update({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      issue_number: notification.number,
      state: 'closed',
    });

    await this.removeLabelFromIssue(
      notification.number,
      NotificationStatus.PENDING,
    );

    console.log(`Notification closed for removed user ${user.login}`);
    return outcome;
  }

  /**
   * Close notification for a user who became active
   */
  async closeNotificationForActiveUser(
    user: LastActivityRecord | Pick<LastActivityRecord, 'login'>,
    notification: NotificationIssue,
  ): Promise<void> {
    console.log(`Closing notification for active user ${user.login}`);
    await this.closeNotification(
      notification,
      NotificationStatus.ACTIVE,
      `User ${user.login} is now active. No removal needed.`,
    );
    console.log(`Notification closed for active user ${user.login}`);
  }

  /**
   * Close notification for a user who is no longer covered by the check, for
   * example because they already left the organization
   */
  async closeNotificationForDepartedUser(
    user: Pick<LastActivityRecord, 'login'>,
    notification: NotificationIssue,
  ): Promise<void> {
    console.log(`Closing notification for departed user ${user.login}`);
    await this.closeNotification(
      notification,
      NotificationStatus.DEPARTED,
      `User ${user.login} is no longer in scope. No removal needed.`,
    );
    console.log(`Notification closed for departed user ${user.login}`);
  }

  /**
   * Mark user for admin exclusion
   */
  async markAdminExclusion(
    user: LastActivityRecord,
    notification: NotificationIssue,
    reason: string,
  ): Promise<void> {
    console.log(`Marking admin exclusion for ${user.login}: ${reason}`);

    // Add comment and label
    await this.addCommentToIssue(
      notification.number,
      `Admin exclusion applied for ${user.login}: ${reason}`,
    );

    await this.addLabelToIssue(
      notification.number,
      NotificationStatus.EXCLUDED,
    );

    console.log(`Admin exclusion marked for ${user.login}`);
  }

  /**
   * Get notifications by status
   */
  async getNotificationsByStatus(
    status: NotificationStatus,
  ): Promise<Array<{ user: string; notification: NotificationIssue }>> {
    const issues = await getNotifications({
      octokit: this.octokit,
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      params: {
        state: 'open',
        labels: `${status}`,
      },
    });

    return issues.map((issue) => ({
      user: issue.title,
      notification: issue as NotificationIssue,
    }));
  }

  // Helper methods

  /**
   * List open notification issues once and index them by lowercase title.
   * When several open issues share a title, the oldest one is used.
   */
  private async getOpenNotificationsByLogin(): Promise<
    Map<string, NotificationIssue>
  > {
    const issues = await getNotifications({
      octokit: this.octokit,
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      params: {
        state: 'open',
        labels: this.config.repository.baseLabels.join(','),
      },
    });

    const byLogin = new Map<string, NotificationIssue>();
    for (const issue of issues) {
      if (issue.pull_request) {
        continue;
      }

      const notification = issue as NotificationIssue;
      const login = notification.title.toLowerCase();
      const existing = byLogin.get(login);
      if (!existing) {
        byLogin.set(login, notification);
        continue;
      }

      const oldest =
        Date.parse(notification.created_at) < Date.parse(existing.created_at)
          ? notification
          : existing;
      console.warn(
        `Multiple open notifications found for ${notification.title}; using #${oldest.number}`,
      );
      byLogin.set(login, oldest);
    }
    return byLogin;
  }

  /**
   * Comment on, relabel and close a notification issue as not planned
   */
  private async closeNotification(
    notification: NotificationIssue,
    status: NotificationStatus,
    comment: string,
  ): Promise<void> {
    await Promise.all([
      this.addCommentToIssue(notification.number, comment),
      this.addLabelToIssue(notification.number, status),
      this.removeLabelFromIssue(
        notification.number,
        NotificationStatus.PENDING,
      ),
    ]);

    await this.octokit.rest.issues.update({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      issue_number: notification.number,
      state: 'closed',
      state_reason: 'not_planned',
    });
  }

  /**
   * Add a comment to an issue
   */
  private async addCommentToIssue(
    issueNumber: number,
    comment: string,
  ): Promise<void> {
    await this.octokit.rest.issues.createComment({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      issue_number: issueNumber,
      body: comment,
    });
  }

  /**
   * Add a label to an issue
   */
  private async addLabelToIssue(
    issueNumber: number,
    label: string,
  ): Promise<void> {
    await this.octokit.rest.issues.addLabels({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      issue_number: issueNumber,
      labels: [label],
    });
  }

  /**
   * Remove a label from an issue
   */
  private async removeLabelFromIssue(
    issueNumber: number,
    label: string,
  ): Promise<void> {
    try {
      await this.octokit.rest.issues.removeLabel({
        owner: this.config.repository.owner,
        repo: this.config.repository.repo,
        issue_number: issueNumber,
        name: label,
      });
      console.log(`Removed label ${label} from issue #${issueNumber}`);
    } catch (error) {
      // Check if error is because the label doesn't exist on the issue
      if ((error as any)?.status === 404) {
        console.log(
          `Label ${label} not found on issue #${issueNumber}, skipping removal`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Check if issue has a specific label
   */
  private hasLabel(issue: NotificationIssue, label: string): boolean {
    return issue.labels.some((l) =>
      typeof l === 'string' ? l === label : l.name === label,
    );
  }
}

/**
 * Normalize a removal handler result into a {@link RemoveAccountOutcome}
 *
 * @param result - Value returned by a {@link RemoveAccountHandler}
 * @returns `removed` for `true`, `skipped` for `false` or unknown values,
 * otherwise the outcome as returned
 */
export function normalizeRemoveAccountOutcome(
  result: boolean | RemoveAccountOutcome | undefined | null,
): RemoveAccountOutcome {
  if (result === true || result === 'removed') {
    return 'removed';
  }
  if (result === 'already-absent') {
    return 'already-absent';
  }
  return 'skipped';
}

function toLowercaseSet(
  logins: Iterable<string> | undefined,
): Set<string> | undefined {
  if (!logins) {
    return undefined;
  }
  return new Set([...logins].map((login) => login.toLowerCase()));
}
