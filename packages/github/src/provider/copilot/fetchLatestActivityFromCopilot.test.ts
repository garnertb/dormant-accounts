import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLatestActivityFromCopilot } from './fetchLatestActivityFromCopilot';

describe('fetchLatestActivityFromCopilot', () => {
  // Mock logger with minimal required properties
  const mockLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    // Additional required properties for the ConsolaInstance type
    options: {},
  } as any;

  // Define the seat type for better type safety
  /**
   * Interface representing a GitHub Copilot seat for testing purposes.
   * Contains user information and activity data.
   */
  interface MockCopilotSeat {
    readonly assignee: { readonly login: string };
    readonly last_activity_at: string | null;
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
});
