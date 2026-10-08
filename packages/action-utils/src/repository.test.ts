import { describe, expect, it } from 'vitest';
import { parseRepository } from './repository';

describe('parseRepository', () => {
  it('parses owner/repo', () => {
    expect(parseRepository(' acme/logs ', 'activity-log-repo')).toEqual({
      owner: 'acme',
      repo: 'logs',
    });
  });

  it.each(['', 'acme', 'acme/', '/logs', 'acme/logs/extra'])(
    'rejects %j',
    (value) => {
      expect(() => parseRepository(value, 'activity-log-repo')).toThrow(
        /Invalid activity-log-repo format/,
      );
    },
  );
});
