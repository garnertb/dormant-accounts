import { describe, it, expect } from 'vitest';
import {
  createDefaultNotificationBodyHandler,
  type NotificationBodyHandler,
} from './templateHandler';

describe('createDefaultNotificationBodyHandler', () => {
  it('should replace all placeholders in the template', () => {
    // Arrange
    const template =
      'Hello {{account}}, your last activity was on {{lastActivity}}. You have {{gracePeriod}} to reactivate your account. Time since last activity: {{timeSinceLastActivity}}';
    const handler = createDefaultNotificationBodyHandler(template);

    const context = {
      lastActivityRecord: {
        login: 'testuser',
        lastActivityLocalized: '2023-05-22',
        humanFriendlyDuration: '30 days',
        lastActivity: new Date('2023-05-22'),
        type: 'user', // Adding required type property
      },
      gracePeriod: '7 days',
    };

    // Act
    const result = handler(context);

    // Assert
    expect(result).toBe(
      'Hello testuser, your last activity was on 2023-05-22. You have 7 days to reactivate your account. Time since last activity: 30 days',
    );
  });

  it('should handle missing lastActivityLocalized with default value', () => {
    // Arrange
    const template =
      'Hello {{account}}, your last activity was on {{lastActivity}}';
    const handler = createDefaultNotificationBodyHandler(template);

    const context = {
      lastActivityRecord: {
        login: 'testuser',
        lastActivity: null,
        type: 'user', // Adding required type property
      },
      gracePeriod: '7 days',
    };

    // Act
    const result = handler(context);

    // Assert
    expect(result).toBe('Hello testuser, your last activity was on None');
  });

  it('should handle missing humanFriendlyDuration with default value', () => {
    // Arrange
    const template = 'Time since last activity: {{timeSinceLastActivity}}';
    const handler = createDefaultNotificationBodyHandler(template);

    const context = {
      lastActivityRecord: {
        login: 'testuser',
        lastActivity: new Date(),
        type: 'user', // Adding required type property
      },
      gracePeriod: '7 days',
    };

    // Act
    const result = handler(context);

    // Assert
    expect(result).toBe('Time since last activity: N/A');
  });

  it('should include dormantAfter when provided', () => {
    // Arrange
    const template = 'Account is dormant after {{dormantAfter}}';
    const handler = createDefaultNotificationBodyHandler(template);

    const context = {
      lastActivityRecord: {
        login: 'testuser',
        lastActivity: new Date(),
        type: 'user', // Adding required type property
      },
      gracePeriod: '7 days',
      dormantAfter: '90 days',
    };

    // Act
    const result = handler(context);

    // Assert
    expect(result).toBe('Account is dormant after 90 days');
  });

  it('should not replace dormantAfter placeholder when not provided', () => {
    // Arrange
    const template = 'Account is dormant after {{dormantAfter}}';
    const handler = createDefaultNotificationBodyHandler(template);

    const context = {
      lastActivityRecord: {
        login: 'testuser',
        lastActivity: new Date(),
        type: 'user', // Adding required type property
      },
      gracePeriod: '7 days',
      // dormantAfter intentionally omitted
    };

    // Act
    const result = handler(context);

    // Assert
    expect(result).toBe('Account is dormant after {{dormantAfter}}');
  });

  it('should handle multiple placeholders of the same type', () => {
    // Arrange
    const template =
      'User {{account}} ({{account}}) has been inactive since {{lastActivity}}';
    const handler = createDefaultNotificationBodyHandler(template);

    const context = {
      lastActivityRecord: {
        login: 'testuser',
        lastActivityLocalized: '2023-05-22',
        lastActivity: new Date('2023-05-22'),
        type: 'user', // Adding required type property
      },
      gracePeriod: '7 days',
    };

    // Act
    const result = handler(context);

    // Assert
    expect(result).toBe(
      'User testuser (testuser) has been inactive since 2023-05-22',
    );
  });
});
