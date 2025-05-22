import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeAccount } from './removeAccount.js';
import { revokeCopilotLicense } from './revokeLicense.js';

describe('copilot module', () => {
  const mockOctokit = {
    rest: {
      copilot: {
        cancelCopilotSeatAssignmentForUsers: vi.fn(),
      },
    },
  };

  const mockConsoleInfo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - partial mock
    console.info = mockConsoleInfo;
  });

  describe('removeAccount', () => {
    it('should call revokeCopilotLicense with correct parameters', async () => {
      // Setup
      const login = 'testuser';
      const org = 'testorg';
      const dryRun = false;

      // @ts-expect-error - partial mock
      mockOctokit.rest.copilot.cancelCopilotSeatAssignmentForUsers.mockResolvedValue(
        {
          data: { seats_cancelled: 1 },
        },
      );

      // Execute
      const result = await removeAccount({
        login,
        // @ts-expect-error - partial mock
        octokit: mockOctokit,
        org,
        dryRun,
      });

      // Verify
      expect(
        mockOctokit.rest.copilot.cancelCopilotSeatAssignmentForUsers,
      ).toHaveBeenCalledWith({
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
      // @ts-expect-error - partial mock
      const result = await revokeCopilotLicense({
        logins,
        octokit: mockOctokit,
        org,
        dryRun,
      });

      // Verify
      expect(
        mockOctokit.rest.copilot.cancelCopilotSeatAssignmentForUsers,
      ).not.toHaveBeenCalled();
      expect(mockConsoleInfo).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN'),
      );
      expect(result).toBe(false);
    });

    it('should handle multiple usernames correctly', async () => {
      // Setup
      const logins = ['user1', 'user2'];
      const org = 'testorg';

      // @ts-expect-error - partial mock
      mockOctokit.rest.copilot.cancelCopilotSeatAssignmentForUsers.mockResolvedValue(
        {
          data: { seats_cancelled: 2 },
        },
      );

      // Execute
      // @ts-expect-error - partial mock
      const result = await revokeCopilotLicense({
        logins,
        octokit: mockOctokit,
        org,
      });

      // Verify
      expect(
        mockOctokit.rest.copilot.cancelCopilotSeatAssignmentForUsers,
      ).toHaveBeenCalledWith({
        org,
        selected_usernames: logins,
      });
      expect(result).toBe(true);
    });
  });
});
