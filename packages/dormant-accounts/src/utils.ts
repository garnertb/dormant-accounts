import { createConsola } from 'consola';
import type { DurationString } from './types';
import type { StringValue } from 'ms';

import ms from 'ms';

export const logger = createConsola({});

/**
 * Converts a duration string to milliseconds.
 *
 * @param duration - A string representing a time duration (e.g., '1d', '2h', '30m')
 * @returns The duration converted to milliseconds, or undefined if no duration is provided
 * @throws {Error} If the duration string format is invalid
 *
 * @example
 * ```typescript
 * durationToMillis('1d') // returns 86400000
 * durationToMillis('2h') // returns 7200000
 * durationToMillis('') // returns undefined
 * ```
 */
export const durationToMillis = (
  duration: DurationString,
): number | undefined => {
  try {
    return duration ? ms(duration as StringValue) : undefined;
  } catch (error) {
    logger.error('Error calculating durationMillis', error);
    throw error;
  }
};

/**
 * Calculates the difference in milliseconds between two dates.
 *
 * @param start - The start date
 * @param end - The end date (defaults to the current date and time)
 * @returns The difference in milliseconds between the two dates
 */
export const msBetweenDates = (start: Date | number, end?: Date): number => {
  const endDate = end ? end.getTime() : Date.now();

  if (typeof start === 'number') {
    return endDate - start;
  }

  return endDate - start.getTime();
};

export const compareDatesAgainstDuration = (
  duration: DurationString,
  start: Date | number,
  end?: Date,
): {
  overDuration: boolean;
  actualDuration: number;
  actualDurationString: string;
} => {
  const durationMillis = durationToMillis(duration);

  if (!durationMillis) {
    throw new Error('Invalid duration string');
  }
  const actualDuration = msBetweenDates(start, end);
  const actualDurationString = ms(actualDuration, { long: true });

  return {
    overDuration: actualDuration > durationMillis,
    actualDuration,
    actualDurationString,
  };
};
