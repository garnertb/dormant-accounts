import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface ActionDefinition {
  inputs: Record<string, { required?: boolean; default?: unknown }>;
  outputs: Record<string, unknown>;
  runs: { using: string; main: string };
}

const action = parse(
  readFileSync(
    fileURLToPath(new URL('../action.yml', import.meta.url)),
    'utf8',
  ),
) as ActionDefinition;

describe('action.yml', () => {
  it('keeps the input names and defaults that workflows depend on', () => {
    const defaults = Object.fromEntries(
      Object.entries(action.inputs).map(([name, input]) => [
        name,
        input.default,
      ]),
    );

    expect(defaults).toEqual({
      org: '${{ github.repository_owner }}',
      'activity-log-repo': '${{ github.repository }}',
      duration: '90d',
      token: '${{ github.token }}',
      'activity-log-token': undefined,
      'notifications-token': undefined,
      'dry-run': 'false',
      'notifications-enabled': 'false',
      'notifications-dry-run': 'false',
      'notifications-repo': '${{ github.repository }}',
      'notifications-duration': '7d',
      'notifications-body': '',
      'assign-user-to-notification-issue': 'false',
      'remove-dormant-accounts': 'false',
      'include-copilot-activity': 'false',
      'authenticated-at-behavior': 'ignore',
      'count-notification-comments': 'false',
      'include-outside-collaborators': 'false',
      'exclude-users': '',
      'first-seen-baseline': 'true',
      'allow-activity-gap': 'false',
    });
  });

  it('marks no input as required, so defaults and fallbacks apply', () => {
    for (const [name, input] of Object.entries(action.inputs)) {
      expect(input.required, name).toBe(false);
    }
  });

  it('declares the outputs set by the action', () => {
    expect(Object.keys(action.outputs)).toEqual([
      'dormant-users',
      'active-users',
      'last-activity-fetch',
      'check-stats',
      'notification-results',
      'error',
    ]);
  });

  it('runs the bundled entrypoint on node20', () => {
    expect(action.runs).toEqual({ using: 'node20', main: 'dist/index.js' });
  });
});
