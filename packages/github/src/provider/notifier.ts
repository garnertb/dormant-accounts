import { getOctokit } from '@actions/github';
import { compareDatesAgainstDuration } from 'dormant-accounts/utils';
import { LastActivityRecord } from 'dormant-accounts';
import { OctokitClient } from './types';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';

export type NotificationIssue = GetResponseDataTypeFromEndpointMethod<
  OctokitClient['rest']['issues']['create']
>;
type CreateNotificationParams = Exclude<
  Parameters<OctokitClient['rest']['issues']['create']>[0],
  'owner' | 'repo'
>;

/**
 * Function type that generates notification body text based on user information
 */
export type NotificationBodyHandler = (user: LastActivityRecord) => string;

/**
 * Status labels for notification issues
 */
export enum NotificationStatus {
  ACTIVE = 'became-active',
  EXCLUDED = 'admin-exclusion',
  PENDING = 'pending-removal',
  REMOVED = 'user-removed',
}

/**
 * Configuration for the notification system
 */
export interface NotificationConfig {
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
}

/**
 * Results from processing dormant users
 */
export interface ProcessingResult {
  notified: Array<{ user: string; notification: NotificationIssue }>;
  removed: Array<{ user: string; notification: NotificationIssue }>;
  reactivated: Array<{ user: string; notification: NotificationIssue }>;
  excluded: Array<{ user: string; notification: NotificationIssue }>;
  inGracePeriod: Array<{ user: string; notification: NotificationIssue }>;
  errors: Array<{ user: string; error: Error }>;
}

/**
 * Main notification service interface
 */
export interface DormantAccountNotifier {
  processDormantUsers(users: LastActivityRecord[]): Promise<ProcessingResult>;
  findReactivatedUsers(
    currentDormantUsers: LastActivityRecord[],
  ): Promise<string[]>;
  notifyUser(user: LastActivityRecord): Promise<NotificationIssue>;
  hasGracePeriodExpired(notification: NotificationIssue): boolean;
  removeUser(
    user: LastActivityRecord,
    notification: NotificationIssue,
  ): Promise<void>;
  closeNotificationForActiveUser(
    user: LastActivityRecord,
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
   * Process a list of dormant users
   */
  async processDormantUsers(
    users: LastActivityRecord[],
  ): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      notified: [],
      removed: [],
      reactivated: [],
      excluded: [],
      inGracePeriod: [],
      errors: [],
    };

    // Find users who were previously notified but now active
    const reactivatedUsers = await this.findReactivatedUsers(users);

    // Process each dormant user
    for (const user of users) {
      try {
        // Skip processing if user was already found to be reactivated
        if (reactivatedUsers.includes(user.login)) {
          continue;
        }

        // Get current notification if it exists
        const notification = await this.getExistingNotification(user.login);

        if (notification) {
          // Check for admin exclusion
          if (this.hasLabel(notification, NotificationStatus.EXCLUDED)) {
            result.excluded.push({ user: user.login, notification });
            continue;
          }

          // Check if grace period expired
          if (this.hasGracePeriodExpired(notification)) {
            if (!this.config.dryRun) {
              await this.removeUser(user, notification);
            }
            result.removed.push({ user: user.login, notification });
          } else {
            // User has been notified but still in grace period
            result.inGracePeriod.push({ user: user.login, notification });
          }
        } else {
          // No existing notification, create one
          if (!this.config.dryRun) {
            const newNotification = await this.notifyUser(user);
            result.notified.push({
              user: user.login,
              notification: newNotification,
            });
          } else {
            // In dry run mode, just log that we would notify
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
        }
      } catch (error) {
        result.errors.push({ user: user.login, error: error as Error });
      }
    }

    // Handle reactivated users
    for (const username of reactivatedUsers) {
      try {
        const notification = await this.getExistingNotification(username);
        if (notification) {
          // Find the user object or create a basic one
          const user = users.find((u) => u.login === username) || {
            login: username,
          };
          if (!this.config.dryRun) {
            await this.closeNotificationForActiveUser(user, notification);
          }
          result.reactivated.push({ user: username, notification });
        }
      } catch (error) {
        result.errors.push({ user: username, error: error as Error });
      }
    }

    return result;
  }

  /**
   * Find users who have open notifications but are no longer dormant
   */
  async findReactivatedUsers(
    currentDormantUsers: LastActivityRecord[],
  ): Promise<string[]> {
    const dormantLogins = new Set(
      currentDormantUsers.map((user) => user.login),
    );

    // Get all open notifications
    const { data: openIssues } = await this.octokit.rest.issues.listForRepo({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      state: 'open',
      labels: this.config.repository.baseLabels.join(','),
    });

    // Find notifications for users who are no longer dormant
    return openIssues
      .filter((issue) => !dormantLogins.has(issue.title))
      .map((issue) => issue.title);
  }

  /**
   * Create a notification for a user
   */
  async notifyUser(user: LastActivityRecord): Promise<NotificationIssue> {
    console.log(`Creating notification for ${user.login}`);

    // Generate notification body based on whether it's a string or function
    const notificationBody =
      typeof this.config.notificationBody === 'function'
        ? this.config.notificationBody(user)
        : this.config.notificationBody;

    const { data } = await this.octokit.rest.issues.create({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      title: user.login,
      body: `@${user.login}\n\n${notificationBody}`,
      labels: [
        ...this.config.repository.baseLabels,
        NotificationStatus.PENDING,
      ],
      assignees: [this.config.assignUserToIssue ? user.login : 'garnertb'],
    });

    console.log(`Notification created for ${user.login}`);
    return data;
  }

  /**
   * Check if notification grace period has expired
   */
  hasGracePeriodExpired(notification: NotificationIssue): boolean {
    return compareDatesAgainstDuration(
      this.config.gracePeriod,
      new Date(notification.created_at),
    ).overDuration;
  }

  /**
   * Remove a user after grace period expiration
   */
  async removeUser(
    user: LastActivityRecord,
    notification: NotificationIssue,
  ): Promise<void> {
    console.log(`Removing user ${user.login}`);

    // Add comment and label before closing
    await this.addCommentToIssue(
      notification.number,
      `User ${user.login} removed due to inactivity after ${this.config.gracePeriod} grace period.`,
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

    // Here you would add code to actually remove the user from your organization
    // For example:
    // await this.octokit.rest.orgs.removeMembershipForUser({
    //   org: "yourOrg",
    //   username: user.login
    // });
  }

  /**
   * Close notification for a user who became active
   */
  async closeNotificationForActiveUser(
    user: LastActivityRecord | Pick<LastActivityRecord, 'login'>,
    notification: NotificationIssue,
  ): Promise<void> {
    console.log(`Closing notification for active user ${user.login}`);

    // Add comment and label
    await this.addCommentToIssue(
      notification.number,
      `User ${user.login} is now active. No removal needed.`,
    );

    await this.addLabelToIssue(notification.number, NotificationStatus.ACTIVE);

    // Close the issue
    await this.octokit.rest.issues.update({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      issue_number: notification.number,
      state: 'closed',
    });

    console.log(`Notification closed for active user ${user.login}`);
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
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      state: 'all',
      labels: `${status}`,
    });

    return data.map((issue) => ({
      user: issue.title,
      notification: issue as NotificationIssue,
    }));
  }

  // Helper methods

  /**
   * Get existing notification for a user
   */
  private async getExistingNotification(
    username: string,
  ): Promise<NotificationIssue | null> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner: this.config.repository.owner,
      repo: this.config.repository.repo,
      state: 'open',
      labels: this.config.repository.baseLabels.join(','),
      assignee: this.config.assignUserToIssue ? username : 'garnertb',
    });

    return (
      (data.find((issue) => issue.title === username) as NotificationIssue) ||
      null
    );
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
 * Creates a default notification body handler that includes last activity date
 */
export function createDefaultNotificationBodyHandler(
  notificationTemplate: string,
  gracePeriod: string,
): NotificationBodyHandler {
  return (user: LastActivityRecord): string => {
    const lastActivityDate = user.lastActivity
      ? new Date(user.lastActivity).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'an unknown date';

    return notificationTemplate
      .replace('{{lastActivity}}', lastActivityDate)
      .replace('{{gracePeriod}}', gracePeriod);
  };
}

/**
 * Example usage:
 *
 * const notifier = new GithubIssueNotifier();
 * await notifier.initialize({
 *   gracePeriod: '7d',
 *   notificationBody: createDefaultNotificationBodyHandler(
 *     'Your account has been inactive since {{lastActivity}} and will be removed in {{gracePeriod}}.',
 *     '7 days'
 *   ),
 *   repository: {
 *     owner: 'org-name',
 *     repo: 'notifications-repo',
 *     baseLabels: ['inactive-user'],
 *   },
 *   githubClient: octokit,
 *   dryRun: true  // Set to false when ready to apply changes
 * });
 *
 * const dormantUsers = [...]; // List of dormant users
 * const result = await notifier.processDormantUsers(dormantUsers);
 * console.log(result);
 */
