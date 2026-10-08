import * as core from '@actions/core';
import {
  parseRepository,
  type RepoContext,
} from '@dormant-accounts/action-utils';
import type { AuthenticatedAtBehavior } from '@dormant-accounts/github';
import { durationToMillis } from 'dormant-accounts/utils';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const AUTHENTICATED_AT_BEHAVIORS: readonly AuthenticatedAtBehavior[] = [
  'ignore',
  'fallback',
  'most-recent',
];

/**
 * Inputs read by the GitHub dormancy action. The notification inputs are read
 * separately by `getNotificationContext`.
 */
export interface ActionInputs {
  org: string;
  activityLogRepo: RepoContext;
  duration: string;
  token: string;
  activityLogToken: string;
  notificationsToken: string;
  dryRun: boolean;
  includeCopilotActivity: boolean;
  authenticatedAtBehavior: AuthenticatedAtBehavior;
  /** Notification repository whose comments count as activity, when enabled */
  notificationCommentsRepo?: RepoContext;
  includeOutsideCollaborators: boolean;
  /** Lowercase logins that are always treated as active */
  excludeUsers: Set<string>;
  firstSeenBaseline: boolean;
  allowActivityGap: boolean;
}

/**
 * Reads a boolean input, returning the default when the input is empty.
 *
 * @param name - The input name
 * @param defaultValue - Value used when the input is empty
 * @returns The parsed boolean
 * @throws When the input is not a YAML 1.2 boolean
 */
export function readBooleanInput(name: string, defaultValue: boolean): boolean {
  if (core.getInput(name) === '') {
    return defaultValue;
  }
  return core.getBooleanInput(name);
}

/**
 * Validates an `ms` duration of at least one day, which rules out values such
 * as `90` (milliseconds) or `3m` (minutes) that would mark every account dormant.
 *
 * @param value - The duration string, e.g. `90d` or `90 days`
 * @param inputName - Name of the input, used in the error message
 * @returns The trimmed duration
 * @throws When the duration is empty, invalid or shorter than one day
 */
export function validateDuration(value: string, inputName: string): string {
  const duration = value.trim();
  const millis = duration ? durationToMillis(duration) : undefined;

  if (millis === undefined || !Number.isFinite(millis) || millis < ONE_DAY_MS) {
    throw new Error(
      `Invalid ${inputName} "${value}". Expected a duration of at least one day, such as "90d", "90 days" or "13w"`,
    );
  }

  return duration;
}

/**
 * Parses a list of logins separated by commas, whitespace or newlines.
 *
 * @param value - The raw input value
 * @returns Lowercase logins without a leading `@`
 */
export function parseLoginList(value: string): Set<string> {
  return new Set(
    value
      .split(/[\s,]+/)
      .map((login) => login.replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  );
}

const readRequiredInput = (name: string): string => {
  const value = core.getInput(name);
  if (!value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
};

const readAuthenticatedAtBehavior = (): AuthenticatedAtBehavior => {
  const value = core.getInput('authenticated-at-behavior') || 'ignore';

  if (!(AUTHENTICATED_AT_BEHAVIORS as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid authenticated-at-behavior "${value}". Expected one of: ${AUTHENTICATED_AT_BEHAVIORS.join(', ')}`,
    );
  }

  return value as AuthenticatedAtBehavior;
};

/**
 * Reads and validates the action inputs.
 *
 * @returns The parsed inputs
 * @throws When an input is missing or invalid
 */
export function readInputs(): ActionInputs {
  const token = readRequiredInput('token');
  const countNotificationComments = readBooleanInput(
    'count-notification-comments',
    false,
  );

  return {
    org: readRequiredInput('org'),
    activityLogRepo: parseRepository(
      core.getInput('activity-log-repo'),
      'activity-log-repo',
    ),
    duration: validateDuration(core.getInput('duration'), 'duration'),
    token,
    activityLogToken: core.getInput('activity-log-token') || token,
    notificationsToken: core.getInput('notifications-token') || token,
    dryRun: readBooleanInput('dry-run', false),
    includeCopilotActivity: readBooleanInput('include-copilot-activity', false),
    authenticatedAtBehavior: readAuthenticatedAtBehavior(),
    notificationCommentsRepo: countNotificationComments
      ? parseRepository(
          core.getInput('notifications-repo'),
          'notifications-repo',
        )
      : undefined,
    includeOutsideCollaborators: readBooleanInput(
      'include-outside-collaborators',
      false,
    ),
    excludeUsers: parseLoginList(core.getInput('exclude-users')),
    firstSeenBaseline: readBooleanInput('first-seen-baseline', true),
    allowActivityGap: readBooleanInput('allow-activity-gap', false),
  };
}
