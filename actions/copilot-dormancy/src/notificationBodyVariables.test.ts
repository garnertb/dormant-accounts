import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDefaultNotificationBodyHandler } from '@dormant-accounts/github';
import type { NotificationHandlerContext } from '@dormant-accounts/github';

describe('Notification Body Variable Resolution', () => {
  /**
   * Creates a mock context object for testing notification templates
   */
  const createMockContext = (
    overrides?: Partial<NotificationHandlerContext>,
  ): NotificationHandlerContext => ({
    lastActivityRecord: {
      login: 'test-user',
      lastActivity: new Date('2023-01-15T10:30:00Z'),
      lastActivityLocalized: 'January 15, 2023',
      humanFriendlyDuration: '90 days ago',
      type: 'user',
    },
    gracePeriod: '7d',
    dormantAfter: '90d',
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Basic Variable Resolution', () => {
    it('should resolve {{account}} variable correctly', () => {
      const template = 'Hello {{account}}, your account needs attention.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('Hello test-user, your account needs attention.');
    });

    it('should resolve {{lastActivity}} variable correctly', () => {
      const template = 'Your last activity was on {{lastActivity}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('Your last activity was on January 15, 2023.');
    });

    it('should resolve {{gracePeriod}} variable correctly', () => {
      const template = 'You have {{gracePeriod}} to reactivate your account.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('You have 7d to reactivate your account.');
    });

    it('should resolve {{timeSinceLastActivity}} variable correctly', () => {
      const template =
        'Your account has been inactive for {{timeSinceLastActivity}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('Your account has been inactive for 90 days ago.');
    });

    it('should resolve {{dormantAfter}} variable correctly', () => {
      const template =
        'Accounts are considered dormant after {{dormantAfter}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('Accounts are considered dormant after 90d.');
    });
  });

  describe('Multiple Variable Resolution', () => {
    it('should resolve multiple different variables in a single template', () => {
      const template =
        'Hi {{account}}! Your last activity was on {{lastActivity}}. ' +
        'You have {{gracePeriod}} to reactivate. Time since last activity: {{timeSinceLastActivity}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe(
        'Hi test-user! Your last activity was on January 15, 2023. ' +
          'You have 7d to reactivate. Time since last activity: 90 days ago.',
      );
    });

    it('should resolve multiple instances of the same variable', () => {
      const template =
        'User {{account}} (login: {{account}}) has been inactive since {{lastActivity}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe(
        'User test-user (login: test-user) has been inactive since January 15, 2023.',
      );
    });

    it('should resolve all available variables in a comprehensive template', () => {
      const template =
        '⚠️ Account Dormancy Notice for {{account}}\n\n' +
        'Your GitHub Copilot account has been inactive for {{timeSinceLastActivity}}.\n' +
        'Last activity: {{lastActivity}}\n' +
        'Dormancy threshold: {{dormantAfter}}\n' +
        'Grace period remaining: {{gracePeriod}}\n\n' +
        'Please reactivate your account within {{gracePeriod}} to avoid removal.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe(
        '⚠️ Account Dormancy Notice for test-user\n\n' +
          'Your GitHub Copilot account has been inactive for 90 days ago.\n' +
          'Last activity: January 15, 2023\n' +
          'Dormancy threshold: 90d\n' +
          'Grace period remaining: 7d\n\n' +
          'Please reactivate your account within 7d to avoid removal.',
      );
    });
  });

  describe('Edge Cases and Default Values', () => {
    it('should handle missing lastActivityLocalized with default value', () => {
      const template = 'Last activity: {{lastActivity}}';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext({
        lastActivityRecord: {
          login: 'test-user',
          lastActivity: new Date('2023-01-15T10:30:00Z'),
          lastActivityLocalized: undefined,
          humanFriendlyDuration: '90 days ago',
          type: 'user',
        },
      });

      const result = handler(context);

      expect(result).toBe('Last activity: None');
    });

    it('should handle missing humanFriendlyDuration with default value', () => {
      const template = 'Time since activity: {{timeSinceLastActivity}}';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext({
        lastActivityRecord: {
          login: 'test-user',
          lastActivity: new Date('2023-01-15T10:30:00Z'),
          lastActivityLocalized: 'January 15, 2023',
          humanFriendlyDuration: undefined,
          type: 'user',
        },
      });

      const result = handler(context);

      expect(result).toBe('Time since activity: N/A');
    });

    it('should not replace {{dormantAfter}} when not provided in context', () => {
      const template = 'Dormant after: {{dormantAfter}}';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext({
        dormantAfter: undefined,
      });

      const result = handler(context);

      expect(result).toBe('Dormant after: {{dormantAfter}}');
    });

    it('should handle empty template gracefully', () => {
      const template = '';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('');
    });

    it('should handle template with no variables', () => {
      const template = 'This is a static notification message.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe('This is a static notification message.');
    });
  });

  describe('Special Characters and Formatting', () => {
    it('should preserve markdown formatting in templates', () => {
      const template =
        '**Important:** User {{account}} needs to reactivate by {{gracePeriod}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe(
        '**Important:** User test-user needs to reactivate by 7d.',
      );
    });

    it('should handle templates with line breaks and special characters', () => {
      const template =
        '🚨 Alert for {{account}}!\n\n' +
        '📅 Last seen: {{lastActivity}}\n' +
        '⏰ Grace period: {{gracePeriod}}\n' +
        '💡 Pro tip: Stay active to avoid this notice!';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe(
        '🚨 Alert for test-user!\n\n' +
          '📅 Last seen: January 15, 2023\n' +
          '⏰ Grace period: 7d\n' +
          '💡 Pro tip: Stay active to avoid this notice!',
      );
    });

    it('should handle HTML entities and special characters in user data', () => {
      const template = 'User {{account}} last active: {{lastActivity}}';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext({
        lastActivityRecord: {
          login: 'user-with-dashes',
          lastActivity: new Date('2023-01-15T10:30:00Z'),
          lastActivityLocalized: 'January 15, 2023 @ 10:30 AM',
          humanFriendlyDuration: '90 days ago',
          type: 'user',
        },
      });

      const result = handler(context);

      expect(result).toBe(
        'User user-with-dashes last active: January 15, 2023 @ 10:30 AM',
      );
    });
  });

  describe('Variable Case Sensitivity', () => {
    it('should be case-sensitive for variable names', () => {
      const template = 'User {{Account}} vs {{account}}';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      // {{Account}} should not be replaced, {{account}} should be
      expect(result).toBe('User {{Account}} vs test-user');
    });

    it('should not replace partial variable matches', () => {
      const template = 'Account info: {{accountInfo}} and {{account}}';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      // Only {{account}} should be replaced, not {{accountInfo}}
      expect(result).toBe('Account info: {{accountInfo}} and test-user');
    });
  });

  describe('Real-world Template Examples', () => {
    it('should resolve variables in a GitHub Copilot dormancy notification template', () => {
      const template = `Hello {{account}},

Your GitHub Copilot license has been inactive for {{timeSinceLastActivity}}.

📊 **Account Details:**
• Last activity: {{lastActivity}}
• Inactive threshold: {{dormantAfter}}
• Grace period: {{gracePeriod}}

⚠️ **Action Required:**
To keep your Copilot access, please use GitHub Copilot within the next {{gracePeriod}}.

If no activity is detected within this period, your license will be automatically removed to optimize our subscription costs.

---
This is an automated message from the GitHub Copilot dormancy monitoring system.`;

      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toContain('Hello test-user,');
      expect(result).toContain('inactive for 90 days ago.');
      expect(result).toContain('Last activity: January 15, 2023');
      expect(result).toContain('Inactive threshold: 90d');
      expect(result).toContain('Grace period: 7d');
      expect(result).toContain('within the next 7d.');
    });

    it('should resolve variables in a simple notification template', () => {
      const template =
        'Hi {{account}}, you have {{gracePeriod}} to reactivate your account.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext({
        gracePeriod: '30d',
      });

      const result = handler(context);

      expect(result).toBe(
        'Hi test-user, you have 30d to reactivate your account.',
      );
    });

    it('should resolve variables in a brief warning template', () => {
      const template =
        '{{account}}: Copilot inactive since {{lastActivity}}. Reactivate within {{gracePeriod}}.';
      const handler = createDefaultNotificationBodyHandler(template);
      const context = createMockContext();

      const result = handler(context);

      expect(result).toBe(
        'test-user: Copilot inactive since January 15, 2023. Reactivate within 7d.',
      );
    });
  });

  describe('Integration with Different Context Values', () => {
    it('should handle different grace period formats', () => {
      const template = 'Grace period: {{gracePeriod}}';
      const handler = createDefaultNotificationBodyHandler(template);

      const testCases = ['7d', '30 days', '1 week', '2w'];

      testCases.forEach((gracePeriod) => {
        const context = createMockContext({ gracePeriod });
        const result = handler(context);
        expect(result).toBe(`Grace period: ${gracePeriod}`);
      });
    });

    it('should handle different user login formats', () => {
      const template = 'User: {{account}}';
      const handler = createDefaultNotificationBodyHandler(template);

      const testUsers = [
        'john-doe',
        'user123',
        'test_user',
        'a',
        'very-long-username',
      ];

      testUsers.forEach((login) => {
        const context = createMockContext({
          lastActivityRecord: {
            ...createMockContext().lastActivityRecord,
            login,
          },
        });
        const result = handler(context);
        expect(result).toBe(`User: ${login}`);
      });
    });

    it('should handle different date formats for last activity', () => {
      const template = 'Last seen: {{lastActivity}}';
      const handler = createDefaultNotificationBodyHandler(template);

      const testDates = [
        'January 15, 2023',
        '2023-01-15',
        'Jan 15, 2023 10:30 AM',
        '15/01/2023',
      ];

      testDates.forEach((lastActivityLocalized) => {
        const context = createMockContext({
          lastActivityRecord: {
            ...createMockContext().lastActivityRecord,
            lastActivityLocalized,
          },
        });
        const result = handler(context);
        expect(result).toBe(`Last seen: ${lastActivityLocalized}`);
      });
    });
  });
});
