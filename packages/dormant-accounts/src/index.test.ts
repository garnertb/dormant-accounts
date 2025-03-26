import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dormancyCheck } from '.';
import {
  LastActivityRecord,
  CreateDormancyCheckConfigurationOptions,
} from './types';
import { Database } from './database';

vi.mock('./database', () => {
  const mockDb = {
    getLastRun: vi.fn(),
    updateLastRun: vi.fn(),
    updateUserActivity: vi.fn(),
    getActivityRecords: vi.fn(),
  };
  return { Database: vi.fn(() => mockDb) };
});

describe('Dormant Account Check', () => {
  const TEST_USERS = [
    { login: 'active1', lastActivity: new Date('2024-01-01'), type: 'test' },
    { login: 'dormant1', lastActivity: new Date('2023-12-01'), type: 'test' },
    {
      login: 'whitelisted1',
      lastActivity: new Date('2024-01-01'),
      type: 'test',
    },
  ];

  let mockDb: ReturnType<typeof vi.mocked<Database>>;
  const NOW = new Date('2025-02-15T00:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    mockDb = vi.mocked(new Database('test'));
    mockDb.getLastRun.mockResolvedValue(new Date('2024-01-01'));
    mockDb.getActivityRecords.mockResolvedValue(TEST_USERS);
    mockDb.updateLastRun.mockResolvedValue();
    mockDb.updateUserActivity.mockResolvedValue();

    vi.mocked(Database).mockImplementation(() => mockDb);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Activity Fetching', () => {
    it('fetches and processes activity', async () => {
      const mockActivity: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2024-01-02'),
        type: 'test',
      };

      const config = {
        type: 'test-check',
        isDormant: vi.fn(),
        fetchLatestActivity: vi.fn().mockResolvedValue([mockActivity]),
      };

      const workflow = dormancyCheck(config);
      await workflow.fetchActivity();

      expect(config.fetchLatestActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          lastFetchTime: new Date('2024-01-01'),
          dryRun: false,
          checkType: 'test-check',
        }),
      );
      expect(mockDb.updateUserActivity).toHaveBeenCalledWith({
        lastActivityRecord: mockActivity,
      });
    });

    it('supports custom activity logging', async () => {
      const mockActivity: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2024-01-02'),
        type: 'test',
      };

      const config = {
        type: 'test-check',
        fetchLatestActivity: vi.fn().mockResolvedValue([mockActivity]),
        logActivityForUser: vi.fn(),
        isDormant: vi.fn(),
        duration: '30d',
      };

      const workflow = dormancyCheck(config);
      await workflow.fetchActivity();

      expect(config.logActivityForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockActivity,
          duration: '30d',
          durationMillis: 2592000000,
          dryRun: false,
          checkType: 'test-check',
        }),
      );
      expect(mockDb.updateUserActivity).not.toHaveBeenCalled();
    });

    it('handles fetch activity errors', async () => {
      const config = {
        type: 'test-check',
        isDormant: vi.fn(),
        fetchLatestActivity: vi
          .fn()
          .mockRejectedValue(new Error('Fetch failed')),
      };

      const workflow = dormancyCheck(config);
      await expect(workflow.fetchActivity()).rejects.toThrow('Fetch failed');
      expect(mockDb.updateLastRun).not.toHaveBeenCalled();
    });

    it('handles concurrent activity updates', async () => {
      const activities = [
        { login: 'user1', lastActivity: new Date('2024-01-02'), type: 'test1' },
        { login: 'user1', lastActivity: new Date('2024-01-03'), type: 'test2' },
        { login: 'user2', lastActivity: new Date('2024-01-02'), type: 'test1' },
      ];

      const config = {
        type: 'test-check',
        isDormant: vi.fn(),
        fetchLatestActivity: vi.fn().mockResolvedValue(activities),
      };

      const workflow = dormancyCheck(config);
      await workflow.fetchActivity();

      expect(mockDb.updateUserActivity).toHaveBeenCalledTimes(3);
      expect(mockDb.updateLastRun).toHaveBeenCalledTimes(1);
    });

    it('retains custom metadata in activity records', async () => {
      const mockActivity: LastActivityRecord = {
        login: 'test-user',
        lastActivity: new Date('2024-01-02'),
        type: 'test',
        // @ts-expect-error
        metadata: { customField: 'value' },
      };

      const config = {
        type: 'test-check',
        isDormant: vi.fn(),
        fetchLatestActivity: vi.fn().mockResolvedValue([mockActivity]),
      };

      const workflow = dormancyCheck(config);
      await workflow.fetchActivity();

      expect(mockDb.updateUserActivity).toHaveBeenCalledWith({
        lastActivityRecord: expect.objectContaining({
          metadata: { customField: 'value' },
        }),
      });
    });
  });

  describe.skip('Inactive User Processing', () => {
    const createConfig = (
      overrides?: Partial<CreateDormancyCheckConfigurationOptions>,
    ) => ({
      type: 'test-check',
      duration: '30d',
      fetchLatestActivity: vi.fn(),
      isDormant: vi.fn().mockResolvedValue(true),
      extendedConfig: { testConfig: true },
      ...overrides,
    });

    it('skips whitelisted users', async () => {
      mockDb.getActivityRecords.mockResolvedValueOnce([
        { login: 'whitelisted', lastActivity: new Date(), type: 'test' },
      ]);

      const config = createConfig({
        isWhitelisted: vi.fn().mockResolvedValue(true),
        extendedConfig: { testConfig: true },
      });

      const workflow = dormancyCheck(config);
      await workflow.listDormantAccounts();
    });

    it('supports async whitelist function', async () => {
      mockDb.getActivityRecords.mockResolvedValueOnce([
        { login: 'user1', lastActivity: new Date(), type: 'test' },
        { login: 'user2', lastActivity: new Date(), type: 'test' },
      ]);

      const config = createConfig({
        isWhitelisted: async (user: { login: string }) =>
          ['user1', 'user2'].includes(user.login),
        isDormant: vi.fn().mockResolvedValue(true),
        extendedConfig: { testConfig: true },
      });

      const workflow = dormancyCheck(config);

      expect(config.isDormant).not.toHaveBeenCalled();
      expect(config.inactivityHandler).not.toHaveBeenCalled();
    });

    it('handles inactive check errors', async () => {
      const config = createConfig({
        isDormant: vi.fn().mockRejectedValue(new Error('Check failed')),
      });
      const workflow = dormancyCheck(config);

      await expect(workflow.summarize()).rejects.toThrow('Check failed');
      expect(config.inactivityHandler).not.toHaveBeenCalled();
    });

    it('handles inactive handler errors', async () => {
      const config = createConfig({
        inactivityHandler: vi
          .fn()
          .mockRejectedValue(new Error('Handler failed')),
      });
      const workflow = dormancyCheck(config);

      await expect(workflow.summarize()).rejects.toThrow('Handler failed');
    });

    it('handles empty activity records', async () => {
      mockDb.getActivityRecords.mockResolvedValueOnce([]);
      const config = createConfig();
      const workflow = dormancyCheck(config);

      await workflow.summarize();

      expect(config.isDormant).not.toHaveBeenCalled();
      expect(config.inactivityHandler).not.toHaveBeenCalled();
    });

    it('processes multiple users in order', async () => {
      const users = [
        { login: 'user1', lastActivity: new Date('2024-01-01'), type: 'test' },
        { login: 'user2', lastActivity: new Date('2024-01-02'), type: 'test' },
      ];
      mockDb.getActivityRecords.mockResolvedValueOnce(users);

      const config = createConfig();
      const workflow = dormancyCheck(config);

      await workflow.summarize();

      expect(config.isDormant).toHaveBeenCalledTimes(2);
      expect(config.isDormant).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ login: 'user1' }),
      );
      expect(config.isDormant).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ login: 'user2' }),
      );
    });

    it('preserves handler context between calls', async () => {
      mockDb.getActivityRecords.mockResolvedValue([
        { login: 'user1', lastActivity: new Date(), type: 'test' },
      ]);

      const config = createConfig();
      config.isDormant = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const workflow = dormancyCheck(config);
      // await workflow.processDormantUsers();
      // await workflow.processDormantUsers();

      expect(config.isDormant).toHaveBeenCalledTimes(2);
      expect(config.inactivityHandler).toHaveBeenCalledTimes(1);
    });

    it('respects whitelist over inactive status', async () => {
      mockDb.getActivityRecords.mockResolvedValueOnce([
        { login: 'whitelisted', lastActivity: new Date(), type: 'test' },
      ]);

      const config = createConfig({
        isWhitelisted: vi.fn().mockResolvedValue(true),
        isDormant: vi.fn().mockResolvedValue(true),
        extendedConfig: { testConfig: true },
      });

      const workflow = dormancyCheck(config);
      //await workflow.processDormantUsers();

      expect(config.isDormant).not.toHaveBeenCalled();
      expect(config.inactivityHandler).not.toHaveBeenCalled();
    });
  });

  describe('Account Status Management', () => {
    const createConfig = (
      overrides?: Partial<CreateDormancyCheckConfigurationOptions>,
    ) => ({
      type: 'test-check',
      fetchLatestActivity: vi.fn(),
      isDormant: vi
        .fn()
        .mockImplementation(({ login }) =>
          Promise.resolve(login.startsWith('dormant')),
        ),
      isWhitelisted: async ({ login }: LastActivityRecord) =>
        login === 'whitelisted1',
      ...overrides,
    });

    beforeEach(() => {
      mockDb.getActivityRecords.mockResolvedValue(TEST_USERS);
    });

    it('lists all accounts', async () => {
      const workflow = dormancyCheck(createConfig());
      const accounts = await workflow.listAccounts();
      expect(accounts).toEqual(TEST_USERS);
    });

    it('lists active accounts', async () => {
      const workflow = dormancyCheck(createConfig());
      const accounts = await workflow.listActiveAccounts();

      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.login)).toContain('active1');
      expect(accounts.map((a) => a.login)).toContain('whitelisted1');
    });

    it('lists dormant accounts', async () => {
      const workflow = dormancyCheck(createConfig());
      const accounts = await workflow.listDormantAccounts();

      expect(accounts).toHaveLength(1);
      expect(accounts[0].login).toBe('dormant1');
    });

    it('generates account summary', async () => {
      const workflow = dormancyCheck(createConfig());
      const summary = await workflow.summarize();

      expect(summary).toEqual({
        lastActivityFetch: '2024-01-01T00:00:00.000Z',
        totalAccounts: 3,
        activeAccounts: 2,
        dormantAccounts: 1,
        activeAccountPercentage: 66.67,
        dormantAccountPercentage: 33.33,
        duration: '30d',
      });
    });

    it('handles empty account list', async () => {
      mockDb.getActivityRecords.mockResolvedValueOnce([]);
      const workflow = dormancyCheck(createConfig());
      const summary = await workflow.summarize();

      expect(summary).toEqual({
        lastActivityFetch: '2024-01-01T00:00:00.000Z',
        totalAccounts: 0,
        activeAccounts: 0,
        dormantAccounts: 0,
        activeAccountPercentage: 0,
        dormantAccountPercentage: 0,
        duration: '30d',
      });
    });

    it('uses default isDormant method if not provided', async () => {
      const workflow = dormancyCheck(
        createConfig({ isDormant: undefined, duration: '10d' }),
      );

      await expect(workflow.listDormantAccounts()).resolves.toHaveLength(2);
      await expect(workflow.listActiveAccounts()).resolves.toHaveLength(1);
    });

    it('uses default duration when not provided', async () => {
      const workflow = dormancyCheck(createConfig({ duration: undefined }));
      const summary = await workflow.summarize();

      expect(summary.duration).toBe('30d');
    });
  });
});
