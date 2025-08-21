/**
 * Matches conventional commit prefixes like "feat:", "fix(scope):", etc.
 */
const CONVENTIONAL_COMMIT_RE = /^(\w+(?:\([^)]*\))?:\s*)(.)/;

/**
 * If the message follows conventional commit format, capitalize the first
 * letter after the type prefix. Otherwise return the message unchanged.
 */
export function capitalizeConventionalCommit(message: string): string {
  return message.replace(CONVENTIONAL_COMMIT_RE, (_, prefix, firstChar) => {
    return prefix + firstChar.toUpperCase();
  });
}
