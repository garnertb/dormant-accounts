import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLatestActivityFromCopilot } from './fetchLatestActivityFromCopilot';

describe('fetchLatestActivityFromCopilot', () => {
  // Mock logger with minimal required properties
  const mockLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    // Additional required properties for the ConsolaInstance type
    options: {},
  } as any;

  // Define the seat type for better type safety
  /**
   * Interface representing a GitHub Copilot seat for testing purposes.
   * Contains user information and activity data.
   */
  interface MockCopilotSeat {
    readonly assignee: { readonly login: string } | null;
    readonly last_activity_at: string | null;
    readonly last_authenticated_at?: string | null;
    readonly last_activity_editor: string | null;
    readonly created_at: string;
    readonly pending_cancellation_date: string | null;
  }

  const createMockOctokit = (seats: MockCopilotSeat[] = []) => ({
    paginate: {
      iterator: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { data: { seats, total_seats: seats.length } };
        },
      }),
    },
    rest: {
      copilot: {
        listCopilotSeats: vi.fn(),
      },
    },
  });

  // Mock for FetchActivityHandler parameters with explicit typing
  const defaultConfig = {
    octokit: null as any,
    org: 'test-org',
    checkType: 'copilot',
    logger: mockLogger,
    lastFetchTime: new Date('2023-01-01'),
    duration: '30d',
    durationMillis: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    dryRun: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return empty array when no seats are found', async () => {
    // Setup
    const mockOctokit = createMockOctokit([]);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toEqual([]);
  });

  it('should process seats with last activity data', async () => {
    // Setup
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const mockSeats = [
      {
        assignee: { login: 'user1' },
        last_activity_at: tenDaysAgo.toISOString(),
        last_activity_editor: 'vscode',
        created_at: new Date('2023-01-01').toISOString(),
        pending_cancellation_date: null,
      },
    ];

    const mockOctokit = createMockOctokit(mockSeats);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      login: 'user1',
      lastActivity: new Date(tenDaysAgo),
      type: 'vscode',
    });
  });

  it('should skip seats with pending cancellation', async () => {
    // Setup
    const mockSeats = [
      {
        assignee: { login: 'user1' },
        last_activity_at: new Date('2023-06-01').toISOString(),
        last_activity_editor: 'vscode',
        created_at: new Date('2023-01-01').toISOString(),
        pending_cancellation_date: new Date('2023-07-01').toISOString(),
      },
      {
        assignee: { login: 'user2' },
        last_activity_at: new Date('2023-06-01').toISOString(),
        last_activity_editor: 'vscode',
        created_at: new Date('2023-01-01').toISOString(),
        pending_cancellation_date: null,
      },
    ];

    const mockOctokit = createMockOctokit(mockSeats);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toHaveLength(1);
    // Use optional chaining to safely access the property
    expect(result[0]?.login).toBe('user2');
  });

  it('should use created_at when last_activity_at is not available', async () => {
    // Setup
    const createdAt = new Date('2023-01-01').toISOString();
    const mockSeats = [
      {
        assignee: { login: 'user1' },
        last_activity_at: null,
        last_activity_editor: null,
        created_at: createdAt,
        pending_cancellation_date: null,
      },
    ];

    const mockOctokit = createMockOctokit(mockSeats);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      login: 'user1',
      lastActivity: new Date(createdAt),
      type: null,
    });
  });

  it('should keep the most recent activity when multiple records exist for same user', async () => {
    // Setup
    const oldDate = new Date('2023-01-01').toISOString();
    const newDate = new Date('2023-06-01').toISOString();

    const mockSeats = [
      {
        assignee: { login: 'user1' },
        last_activity_at: oldDate,
        last_activity_editor: 'vscode',
        created_at: new Date('2022-01-01').toISOString(),
        pending_cancellation_date: null,
      },
      {
        assignee: { login: 'user1' },
        last_activity_at: newDate,
        last_activity_editor: 'jetbrains',
        created_at: new Date('2022-01-01').toISOString(),
        pending_cancellation_date: null,
      },
    ];

    const mockOctokit = createMockOctokit(mockSeats);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      login: 'user1',
      lastActivity: new Date(newDate),
      type: 'jetbrains',
    });
  });

  it('should handle entries with null logins', async () => {
    const mockSeats = [
      {
        assignee: null,
        last_activity_editor: null,
        created_at: new Date('2022-01-01').toISOString(),
        pending_cancellation_date: null,
        last_activity_at: null,
      },
    ];

    const mockOctokit = createMockOctokit(mockSeats);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toHaveLength(0);
  });

  it('should handle errors and throw them', async () => {
    // Setup
    const mockError = new Error('API error');
    const mockOctokit = {
      paginate: {
        iterator: vi.fn().mockImplementation(() => {
          throw mockError;
        }),
      },
      rest: {
        copilot: {
          listCopilotSeats: vi.fn(),
        },
      },
    };

    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute and Assert
    await expect(fetchLatestActivityFromCopilot(config as any)).rejects.toThrow(
      mockError,
    );
  });

  it('should normalize usernames to lowercase', async () => {
    // Setup
    const mockSeats = [
      {
        assignee: { login: 'USER1' },
        last_activity_at: new Date('2023-06-01').toISOString(),
        last_activity_editor: 'vscode',
        created_at: new Date('2023-01-01').toISOString(),
        pending_cancellation_date: null,
      },
    ];

    const mockOctokit = createMockOctokit(mockSeats);
    const config = {
      ...defaultConfig,
      octokit: mockOctokit as any,
    };

    // Execute
    const result = await fetchLatestActivityFromCopilot(config as any);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.login).toBe('user1');
  });

  describe('authenticatedAtBehavior option', () => {
    it('should ignore last_authenticated_at by default when last_activity_at is null', async () => {
      // Setup
      const authenticatedAt = new Date('2023-06-01').toISOString();
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: null,
          last_authenticated_at: authenticatedAt,
          last_activity_editor: null,
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        // authenticatedAtBehavior not set (defaults to 'ignore')
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should use created_at, not last_authenticated_at
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(createdAt),
        type: null,
      });
    });

    it('should use last_authenticated_at as fallback when behavior is fallback and last_activity_at is null', async () => {
      // Setup
      const authenticatedAt = new Date('2023-06-01').toISOString();
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: null,
          last_authenticated_at: authenticatedAt,
          last_activity_editor: null,
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'fallback',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should use last_authenticated_at
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(authenticatedAt),
        type: 'last_authentication',
      });
    });

    it('should prefer last_activity_at over last_authenticated_at in fallback mode', async () => {
      // Setup
      const activityAt = new Date('2023-07-01').toISOString();
      const authenticatedAt = new Date('2023-06-01').toISOString();
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: activityAt,
          last_authenticated_at: authenticatedAt,
          last_activity_editor: 'vscode',
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'fallback',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should use last_activity_at (takes precedence)
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(activityAt),
        type: 'vscode',
      });
    });

    it('should fall back to created_at in fallback mode when last_authenticated_at is also null', async () => {
      // Setup
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: null,
          last_authenticated_at: null,
          last_activity_editor: null,
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'fallback',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should fall back to created_at
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(createdAt),
        type: null,
      });
    });

    it('should use most recent of last_activity_at and last_authenticated_at in most-recent mode (authenticated newer)', async () => {
      // Setup
      const activityAt = new Date('2023-06-01').toISOString();
      const authenticatedAt = new Date('2023-07-01').toISOString(); // More recent
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: activityAt,
          last_authenticated_at: authenticatedAt,
          last_activity_editor: 'vscode',
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'most-recent',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should use last_authenticated_at (more recent)
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(authenticatedAt),
        type: 'last_authentication',
      });
    });

    it('should use most recent of last_activity_at and last_authenticated_at in most-recent mode (activity newer)', async () => {
      // Setup
      const activityAt = new Date('2023-07-01').toISOString(); // More recent
      const authenticatedAt = new Date('2023-06-01').toISOString();
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: activityAt,
          last_authenticated_at: authenticatedAt,
          last_activity_editor: 'vscode',
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'most-recent',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should use last_activity_at (more recent)
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(activityAt),
        type: 'vscode',
      });
    });

    it('should use last_authenticated_at in most-recent mode when last_activity_at is null', async () => {
      // Setup
      const authenticatedAt = new Date('2023-06-01').toISOString();
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: null,
          last_authenticated_at: authenticatedAt,
          last_activity_editor: null,
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'most-recent',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should use last_authenticated_at (only available date besides created_at)
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(authenticatedAt),
        type: 'last_authentication',
      });
    });

    it('should fall back to created_at in most-recent mode when both activity dates are null', async () => {
      // Setup
      const createdAt = new Date('2023-01-01').toISOString();
      const mockSeats = [
        {
          assignee: { login: 'user1' },
          last_activity_at: null,
          last_authenticated_at: null,
          last_activity_editor: null,
          created_at: createdAt,
          pending_cancellation_date: null,
        },
      ];

      const mockOctokit = createMockOctokit(mockSeats);
      const config = {
        ...defaultConfig,
        octokit: mockOctokit as any,
        authenticatedAtBehavior: 'most-recent',
      };

      // Execute
      const result = await fetchLatestActivityFromCopilot(config as any);

      // Assert - should fall back to created_at
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        login: 'user1',
        lastActivity: new Date(createdAt),
        type: null,
      });
    });
  });
});
