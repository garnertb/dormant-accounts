import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultWhitelistHandler } from './audit-log';

// Update the import to import the entire module
import * as database from 'dormant-accounts/database';

// Mock the database module
vi.mock('dormant-accounts/database', () => ({
  default: vi.fn(),
}));

describe('GitHub Activity Check', () => {
  let mockDb: database.Database;

  beforeEach(() => {
    mockDb = {
      getLastRun: vi.fn().mockResolvedValue(new Date('2024-01-01')),
      updateLastRun: vi.fn(),
      updateUserActivity: vi.fn(),
      getActivityRecords: vi.fn().mockResolvedValue([]),
    } as any as database.Database;

    // Update how we set the mock implementation
    // @ts-expect-error
    (database.default as any).mockImplementation(() => mockDb);
  });

  describe('defaultWhitelistHandler', () => {
    it('whitelists bots from being dormant', async () => {
      await expect(
        defaultWhitelistHandler({
          login: 'test[bot]',
          // @ts-expect-error todo
          logger: { debug: vi.fn() },
        }),
      ).resolves.toBe(true);
    });

    it('whitelists bots from being dormant', async () => {
      await expect(
        // @ts-expect-error todo
        defaultWhitelistHandler({ login: 'test', logger: { debug: vi.fn() } }),
      ).resolves.toBe(false);
    });
  });
});
