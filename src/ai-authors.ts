/**
 * Patterns matching known AI co-author identities.
 * Matched case-insensitively against Co-Authored-By trailer values.
 */
const AI_PATTERNS: RegExp[] = [
  /\bclaude\b/i,
  /\bcopilot\b/i,
  /\bchatgpt\b/i,
  /\bopenai\b/i,
  /\bcursor\b/i,
  /\bgithub\s*copilot\b/i,
  /\banthropic\b/i,
  /\bgemini\b/i,
  /\bcodeium\b/i,
  /\btabnine\b/i,
  /\bamazon\s*q\b/i,
  /\bcodewhisperer\b/i,
  /noreply@anthropic\.com/i,
  /noreply@github\.com/i,
];

function isAiCoAuthor(value: string): boolean {
  return AI_PATTERNS.some((p) => p.test(value));
}

/**
 * Remove Co-Authored-By lines that match known AI patterns.
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
