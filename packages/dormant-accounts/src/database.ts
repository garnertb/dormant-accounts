import { LastActivityRecord } from './types';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { logger } from './utils';

type UserRecord = Omit<LastActivityRecord, 'login'>;
type StateData = {
  lastRun: string;
  'check-type': string;
  lastUpdated: string;
};

export interface DatabaseSchema {
  _state: StateData;
  [key: string]: UserRecord | StateData;
}

function isUserRecord(value: unknown): value is UserRecord {
  return typeof value === 'object' && value !== null && 'lastActivity' in value;
}

export class Database {
  private db: Low<DatabaseSchema>;
  private readonly checkType: string;

  constructor(checkType: string, dbPath?: string) {
    this.checkType = checkType;
    const resolvedPath = dbPath || `${checkType}.json`;

    const adapter = new JSONFile<DatabaseSchema>(resolvedPath);
    this.db = new Low(adapter, {
      _state: {
        lastRun: new Date(0).toISOString(),
        'check-type': checkType,
        lastUpdated: new Date(0).toISOString(),
      },
    });
  }

  private async validateCheckType(): Promise<void> {
    await this.db.read();
    const dbCheckType = this.db.data._state['check-type'];

    if (dbCheckType && dbCheckType !== this.checkType) {
      logger.error('Check type mismatch', {
        expected: this.checkType,
        actual: dbCheckType,
      });
      throw new Error(
        `Check type mismatch. Database is configured for "${dbCheckType}" but received "${this.checkType}"`,
      );
    }
  }

  private async writeWithSort(): Promise<void> {
    const sortedData: DatabaseSchema = {
      _state: this.db.data._state,
    };

    const entries = Object.entries(this.db.data)
      .filter(([key]) => key !== '_state')
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of entries) {
      sortedData[key] = value;
    }

    this.db.data = sortedData;
    this.db.data._state.lastUpdated = new Date().toISOString();
    await this.db.write();
  }

  async getLastRun(): Promise<Date> {
    await this.validateCheckType();
    return new Date(this.db.data._state.lastRun);
  }

  async updateLastRun(timestamp: Date = new Date()): Promise<void> {
    await this.validateCheckType();
    this.db.data._state.lastRun = timestamp.toISOString();
    await this.writeWithSort();
  }

  async updateUserActivity({
    lastActivityRecord,
  }: {
    lastActivityRecord: LastActivityRecord;
  }): Promise<void> {
    const { login, ...record } = lastActivityRecord;
    this.db.data[login] = record as UserRecord;
    logger.debug(`User activity updated for login: ${login}`);
    await this.writeWithSort();
  }

  /**
   * Removes a user record from the database
   * @param user Either a LastActivityRecord object or a string login
   * @returns Promise<boolean> true if the user was found and removed, false if not found
   */
  async removeUserActivityRecord(
    user: LastActivityRecord | string,
  ): Promise<boolean> {
    await this.validateCheckType();

    const login = typeof user === 'string' ? user : user.login;

    if (!this.db.data[login] || login === '_state') {
      logger.debug(`User ${login} not found in database, nothing to remove`);
      return false;
    }

    delete this.db.data[login];
    logger.debug(`User ${login} removed from database`);
    await this.writeWithSort();
    return true;
  }

  async getActivityRecords(): Promise<LastActivityRecord[]> {
    await this.validateCheckType();
    return Object.entries(this.db.data)
      .filter(([key, value]) => key !== '_state')
      .map(([login, record]) => {
        if (!isUserRecord(record)) {
          logger.error(
            `Unexpected non-user record found in database: ${JSON.stringify(record)}`,
          );
          throw new Error('Unexpected non-user record found');
        }

        const { lastActivity, ...remaining } = record;

        return {
          login,
          ...remaining,
          lastActivity: lastActivity ? new Date(lastActivity) : null,
        };
      });
  }

  async getRegisteredCheck(): Promise<{
    type: string;
    lastUpdated: Date;
  } | null> {
    await this.db.read();
    return this.db.data._state['check-type']
      ? {
          type: this.db.data._state['check-type'],
          lastUpdated: new Date(this.db.data._state.lastUpdated),
        }
      : null;
  }

  async getRawData(): Promise<DatabaseSchema> {
    await this.validateCheckType();
    return { ...this.db.data };
  }
}
