/**
 * AI co-authors are recognised by identity rather than by a word anywhere in
 * the trailer, so humans who happen to be called Claude, Cursor or Gemini keep
 * their credit.
 */

/** Email domains that only AI assistants co-author from. */
const AI_EMAIL_DOMAINS = new Set([
  "anthropic.com",
  "openai.com",
  "cursor.com",
  "cursor.sh",
  "codeium.com",
  "windsurf.com",
  "tabnine.com",
]);

/** Exact email addresses used by AI assistants. */
const AI_EMAILS = new Set([
  "noreply@github.com", // GitHub Copilot
]);

/**
 * GitHub noreply local parts ("<id>+<login>") of AI bot accounts. Human
 * noreply addresses ("<id>+alice@users.noreply.github.com") don't match.
 */
const AI_GITHUB_LOGIN = /^(\d+\+)?(copilot|[\w.-]+\[bot\])$/i;

/** Full display names that are AI products rather than people. */
const AI_NAMES = new Set([
  "claude code",
  "copilot",
  "github copilot",
  "chatgpt",
  "codex",
  "openai codex",
  "cursor agent",
  "gemini code assist",
  "codeium",
  "windsurf",
  "tabnine",
  "amazon q",
  "amazon q developer",
  "codewhisperer",
  "amazon codewhisperer",
]);

function isAiCoAuthor(value: string): boolean {
  const match = value.trim().match(/^(.*?)\s*<([^>]*)>\s*$/);
  const name = (match ? match[1] : value).trim().toLowerCase();
  const email = (match ? match[2] : "").trim().toLowerCase();

  if (AI_NAMES.has(name) || name.endsWith("[bot]")) return true;
  if (!email) return false;
  if (AI_EMAILS.has(email)) return true;

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (AI_EMAIL_DOMAINS.has(domain)) return true;
  return domain === "users.noreply.github.com" && AI_GITHUB_LOGIN.test(local);
}

/**
 * Remove Co-Authored-By lines that match known AI identities.
 * Preserves human co-author trailers.
 */
export function stripAiCoAuthors(message: string): string {
  const lines = message.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^co-authored-by:\s*(.+)$/i);
    if (match && isAiCoAuthor(match[1])) {
      continue; // skip AI co-author line
    }
    result.push(line);
  }

  // Clean up trailing blank lines that may be left after removal
  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }

  return result.join("\n");
}
