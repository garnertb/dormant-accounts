import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DormantAccountCheck } from './index';
import { Database } from './database';
import { LastActivityRecord } from './types';

// Mock Database
vi.mock('./database', () => {
  return {
    Database: vi.fn().mockImplementation(function () {
      return {
        updateUserActivity: vi.fn().mockResolvedValue(undefined),
        getLastRun: vi.fn().mockResolvedValue(new Date('2023-01-01')),
        updateLastRun: vi.fn().mockResolvedValue(undefined),
        getActivityRecords: vi.fn(),
        removeUserActivityRecord: vi.fn(),
        getRawData: vi.fn().mockResolvedValue({}),
      };
    }),
  };
});

// Mock Logger
vi.mock('./utils', async () => {
  const { logger } = await vi.importActual<typeof import('./utils')>('./utils');
  logger.mockTypes(() => vi.fn());

  return {
    logger,
    durationToMillis: vi.fn().mockReturnValue(1000 * 60 * 60 * 24 * 30), // 30 days
    compareDatesAgainstDuration: vi.fn().mockReturnValue({
      overDuration: false,
      actualDurationString: '10d',
    }),
  };
});

describe('DormantAccountCheck with activityResultType', () => {
  const mockFetchLatestActivity = vi.fn();
  const mockRemoveUser = vi.fn();

  let checker: DormantAccountCheck<unknown>;
  let databaseMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup database mock for this test
    const mockGetActivityRecords = vi.fn().mockResolvedValue([
      { login: 'user1', lastActivity: new Date(), type: 'test' },
      { login: 'user2', lastActivity: new Date(), type: 'test' },
      { login: 'user3', lastActivity: new Date(), type: 'test' },
    ]);

    mockRemoveUser.mockResolvedValue(true);

    // @ts-ignore - we're mocking the implementation
    Database.mockImplementation(function () {
      return {
        updateUserActivity: vi.fn().mockResolvedValue(undefined),
        getLastRun: vi.fn().mockResolvedValue(new Date('2023-01-01')),
        updateLastRun: vi.fn().mockResolvedValue(undefined),
        getActivityRecords: mockGetActivityRecords,
        removeUserActivityRecord: mockRemoveUser,
        getRawData: vi.fn().mockResolvedValue({}),
      };
    });

    databaseMock = (Database as any).mock.results[0]?.value;
  });

  describe('with partial activity results', () => {
    beforeEach(() => {
      // Fresh mock implementation for each test
      mockFetchLatestActivity.mockResolvedValue([
        { login: 'user1', lastActivity: new Date(), type: 'test' },
      ]);

      // Create checker with 'partial' mode (default)
      checker = new DormantAccountCheck({
        type: 'test',
        fetchLatestActivity: mockFetchLatestActivity,
      });
    });

    it('should not remove users not present in the activity results', async () => {
      // Act
      await checker.fetchActivity();

      // Assert
      expect(mockRemoveUser).not.toHaveBeenCalled();
    });
  });

  describe('with complete activity results', () => {
    beforeEach(() => {
      // Fresh mock implementation for each test
      mockFetchLatestActivity.mockResolvedValue([
        { login: 'user1', lastActivity: new Date(), type: 'test' },
      ]);

      // Create checker with 'complete' mode
      checker = new DormantAccountCheck({
        type: 'test',
        fetchLatestActivity: mockFetchLatestActivity,
        activityResultType: 'complete',
      });
    });

    it('should remove users not present in the activity results', async () => {
      // Act
      await checker.fetchActivity();

      // Assert
      // We expect user2 and user3 to be removed as they're not in the activity results
      expect(mockRemoveUser).toHaveBeenCalledTimes(2);

      // Check for user2
      const call1Args = mockRemoveUser.mock.calls[0]?.[0];
      expect(typeof call1Args).toBe('object');
      expect((call1Args as LastActivityRecord).login).toBe('user2');

      // Check for user3
      const call2Args = mockRemoveUser.mock.calls[1]?.[0];
      expect(typeof call2Args).toBe('object');
      expect((call2Args as LastActivityRecord).login).toBe('user3');
    });

    it('should not remove users in dry run mode', async () => {
      // Create checker with 'complete' mode and dry run
      checker = new DormantAccountCheck({
        type: 'test',
        fetchLatestActivity: mockFetchLatestActivity,
        activityResultType: 'complete',
        dryRun: true,
      });

      // Act
      await checker.fetchActivity();

      // Assert
      expect(mockRemoveUser).not.toHaveBeenCalled();
    });
  });
});
