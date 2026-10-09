/**
 * Returns a readable message for an unknown error value.
 *
 * @param error - The caught value
 * @returns The error message, or the value converted to a string
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads the HTTP status from an Octokit request error.
 *
 * @param error - The caught value
 * @returns The status code, or undefined when the value has none
 */
export const errorStatus = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};
