import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeAccount } from './removeAccount.js';
import { revokeCopilotLicense } from './revokeLicense.js';
import type { OctokitClient } from '../types';

describe('copilot module', () => {
  // Create a mock function that we can properly control
  const mockCancelCopilotSeats = vi.fn();

  const mockOctokit = {
    rest: {
      copilot: {
        cancelCopilotSeatAssignmentForUsers: mockCancelCopilotSeats,
      },
    },
  } as unknown as OctokitClient;

  const mockConsoleInfo = vi.fn();
  // Create a complete mock logger using type assertion
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    level: 3,
    prompt: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    withScope: vi.fn().mockReturnThis(),
    withTag: vi.fn().mockReturnThis(),
    wrapConsole: vi.fn(),
    restoreConsole: vi.fn(),
    create: vi.fn().mockReturnThis(),
    options: {},
    _lastLog: null,
    withDefaults: vi.fn().mockReturnThis(),
    addReporter: vi.fn(),
    removeReporter: vi.fn(),
    setReporters: vi.fn(),
    reporters: [],
    success: vi.fn(),
    fail: vi.fn(),
    ready: vi.fn(),
    start: vi.fn(),
    box: vi.fn(),
    log: vi.fn(),
    clear: vi.fn(),
    silent: vi.fn().mockReturnThis(),
    verbose: vi.fn().mockReturnThis(),
    time: vi.fn(),
    timeLog: vi.fn(),
    timeEnd: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    console.info = mockConsoleInfo;
  });

  describe('removeAccount', () => {
    it('should call revokeCopilotLicense with correct parameters', async () => {
      // Setup
      const login = 'testuser';
      const org = 'testorg';
      const dryRun = false;

      mockCancelCopilotSeats.mockResolvedValue({
        data: { seats_cancelled: 1 },
      });

      // Execute
      const result = await removeAccount({
        login,
        octokit: mockOctokit,
        org,
        dryRun,
        // Add required properties for LastActivityRecord
        lastActivity: new Date(),
        type: 'github',
        // Add required properties for PassedDormancyCheckConfiguration
        checkType: 'github',
        logger: mockLogger,
        duration: '30d',
        durationMillis: 1,
      });

      // Verify
      expect(mockCancelCopilotSeats).toHaveBeenCalledWith({
        org,
        selected_usernames: [login],
      });
      expect(result).toBe(true);
    });
  });

  describe('revokeCopilotLicense', () => {
    it('should handle dry run mode correctly', async () => {
      // Setup
      const logins = 'testuser';
      const org = 'testorg';
      const dryRun = true;

      // Execute
      const result = await revokeCopilotLicense({
        logins,
        octokit: mockOctokit,
        org,
        dryRun,
      });

      // Verify
      expect(mockCancelCopilotSeats).not.toHaveBeenCalled();
      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN'),
      );
      expect(result).toBe(false);
    });

    it('should handle multiple usernames correctly', async () => {
      // Setup
      const logins = ['user1', 'user2'];
      const org = 'testorg';

      mockCancelCopilotSeats.mockResolvedValue({
        data: { seats_cancelled: 2 },
      });

      // Execute
      const result = await revokeCopilotLicense({
        logins,
        octokit: mockOctokit,
        org,
      });

      // Verify
      expect(mockCancelCopilotSeats).toHaveBeenCalledWith({
        org,
        selected_usernames: logins,
      });
      expect(result).toBe(true);
    });
  });
});
