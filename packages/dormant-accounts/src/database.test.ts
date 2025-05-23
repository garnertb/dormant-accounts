import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from './database';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { logger } from './utils';

logger.mockTypes(() => vi.fn());

vi.mock('lowdb');
vi.mock('lowdb/node');
vi.mock('fs');

describe('Database', () => {
  const TEST_CHECK_TYPE = 'test-check';
  let db: Database;
  let mockAdapter: any;

  beforeEach(() => {
    mockAdapter = {
      read: vi.fn(),
      write: vi.fn(),
    };
    vi.mocked(JSONFile).mockImplementation(() => mockAdapter);
    //@ts-expect-error
    vi.mocked(Low).mockImplementation(() => ({
      data: {
        _state: {
          lastRun: new Date(0).toISOString(),
          'check-type': TEST_CHECK_TYPE,
          lastUpdated: new Date(0).toISOString(),
        },
      },
      read: mockAdapter.read,
      write: mockAdapter.write,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('uses default path when not provided', () => {
      db = new Database(TEST_CHECK_TYPE);
      expect(JSONFile).toHaveBeenCalledWith(`${TEST_CHECK_TYPE}.json`);
    });

    it('uses custom path when provided', () => {
      const customPath = '/custom/path/db.json';
      db = new Database(TEST_CHECK_TYPE, customPath);
      expect(JSONFile).toHaveBeenCalledWith(customPath);
    });
  });

  describe('operations', () => {
    beforeEach(() => {
      db = new Database(TEST_CHECK_TYPE);
    });

    it('validates check type on operations', async () => {
      const differentCheck = 'different-check';
      const mockDb = {
        data: {
          _state: {
            'check-type': differentCheck,
            lastRun: new Date(0).toISOString(),
            lastUpdated: new Date(0).toISOString(),
          },
        },
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      await expect(db.getLastRun()).rejects.toThrow(/Check type mismatch/);
    });

    it('gets last run date', async () => {
      const lastRun = await db.getLastRun();
      expect(lastRun).toBeInstanceOf(Date);
      expect(mockAdapter.read).toHaveBeenCalled();
    });

    it('updates last run time', async () => {
      await db.updateLastRun();
      expect(mockAdapter.write).toHaveBeenCalled();
    });

    it('updates user activity', async () => {
      await db.updateUserActivity({
        lastActivityRecord: {
          login: 'test-user',
          lastActivity: new Date(),
          type: 'test',
        },
      });
      expect(mockAdapter.write).toHaveBeenCalled();
    });

    it('gets activity records for check type', async () => {
      const mockData = {
        _state: {
          'check-type': TEST_CHECK_TYPE,
          lastRun: new Date(0).toISOString(),
          lastUpdated: new Date(0).toISOString(),
        },
        'test-user': {
          lastActivity: new Date(),
          type: 'test',
        },
      };

      const mockDb = {
        data: mockData,
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      const records = await db.getActivityRecords();
      expect(records).toHaveLength(1);
    });

    it('gets raw database data', async () => {
      const testDate = new Date();
      const mockData = {
        _state: {
          'check-type': TEST_CHECK_TYPE,
          lastRun: testDate.toISOString(),
          lastUpdated: testDate.toISOString(),
        },
        'test-user': {
          lastActivity: testDate.toISOString(),
          type: 'test',
        },
      };

      const mockDb = {
        data: mockData,
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      const data = await db.getRawData();
      expect(data).toEqual(mockData);
      expect(mockAdapter.read).toHaveBeenCalled();
    });

    it('removes user when given activity record', async () => {
      const testUser = 'test-user';
      const mockData = {
        _state: {
          'check-type': TEST_CHECK_TYPE,
          lastRun: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
        [testUser]: {
          lastActivity: new Date().toISOString(),
          type: 'test',
        },
      };

      const mockDb = {
        data: mockData,
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      const result = await db.removeUserActivityRecord({
        login: testUser,
        lastActivity: new Date(),
        type: 'test',
      });

      expect(result).toBe(true);
      expect(mockDb.data[testUser]).toBeUndefined();
      expect(mockAdapter.write).toHaveBeenCalled();
    });

    it('removes user when given login string', async () => {
      const testUser = 'test-user';
      const mockData = {
        _state: {
          'check-type': TEST_CHECK_TYPE,
          lastRun: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
        [testUser]: {
          lastActivity: new Date().toISOString(),
          type: 'test',
        },
      };

      const mockDb = {
        data: mockData,
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      const result = await db.removeUserActivityRecord(testUser);

      expect(result).toBe(true);
      expect(mockDb.data[testUser]).toBeUndefined();
      expect(mockAdapter.write).toHaveBeenCalled();
    });

    it('returns false when removing user that does not exist', async () => {
      const mockData = {
        _state: {
          'check-type': TEST_CHECK_TYPE,
          lastRun: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
      };

      const mockDb = {
        data: mockData,
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      const result = await db.removeUserActivityRecord('non-existent-user');

      expect(result).toBe(false);
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it('prevents removal of _state metadata', async () => {
      const mockData = {
        _state: {
          'check-type': TEST_CHECK_TYPE,
          lastRun: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
      };

      const mockDb = {
        data: mockData,
        read: mockAdapter.read,
        write: mockAdapter.write,
      };

      vi.mocked(Low).mockImplementationOnce(() => mockDb as any);
      db = new Database(TEST_CHECK_TYPE);

      const result = await db.removeUserActivityRecord('_state');

      expect(result).toBe(false);
      expect(mockDb.data._state).toBeDefined();
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });
  });
});
