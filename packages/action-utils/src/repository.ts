/**
 * Owner and name of a repository
 */
export interface RepoContext {
  owner: string;
  repo: string;
}

/**
 * Parses an `owner/repo` string.
 *
 * @param value - Repository in `owner/repo` form
 * @param inputName - Name of the input, used in the error message
 * @returns The repository owner and name
 * @throws When the value is not in `owner/repo` form
 */
export function parseRepository(value: string, inputName: string): RepoContext {
  const [owner, repo, ...rest] = value.trim().split('/');

  if (!owner || !repo || rest.length > 0) {
    throw new Error(
      `Invalid ${inputName} format. Expected "owner/repo", got "${value}"`,
    );
  }

  return { owner, repo };
}
