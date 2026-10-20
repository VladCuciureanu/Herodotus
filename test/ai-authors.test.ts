import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripAiCoAuthors } from "../src/ai-authors.ts";

describe("stripAiCoAuthors", () => {
  it("strips Claude co-author", () => {
    const msg = `Fix login bug

Co-Authored-By: Claude <noreply@anthropic.com>`;
    assert.equal(stripAiCoAuthors(msg), "Fix login bug");
  });

  it("strips Copilot co-author", () => {
    const msg = `Add feature

Co-Authored-By: GitHub Copilot <noreply@github.com>`;
    assert.equal(stripAiCoAuthors(msg), "Add feature");
  });

  it("keeps human co-author", () => {
    const msg = `Refactor auth

Co-Authored-By: Alice <alice@example.com>`;
    assert.equal(stripAiCoAuthors(msg), msg);
  });

  it("strips AI but keeps human", () => {
    const msg = `Update docs

Co-Authored-By: Alice <alice@example.com>
Co-Authored-By: Claude <noreply@anthropic.com>`;
    assert.equal(stripAiCoAuthors(msg), `Update docs

Co-Authored-By: Alice <alice@example.com>`);
  });

  it("handles message with no trailers", () => {
    const msg = "Simple commit message";
    assert.equal(stripAiCoAuthors(msg), msg);
  });

  it("strips ChatGPT co-author", () => {
    const msg = `Fix bug

Co-Authored-By: ChatGPT <chatgpt@openai.com>`;
    assert.equal(stripAiCoAuthors(msg), "Fix bug");
  });

  it("keeps humans whose names match AI product names", () => {
    for (
      const human of [
        "Claude Monet <claude@monet.fr>",
        "Cursor Smith <cursor.smith@example.com>",
        "Gemini Jones <gemini@example.org>",
        "Claude <claude.dupont@example.fr>",
        "Alice <12345+alice@users.noreply.github.com>",
      ]
    ) {
      const msg = `Paint\n\nCo-Authored-By: ${human}`;
      assert.equal(stripAiCoAuthors(msg), msg, human);
    }
  });

  it("strips known bot identities", () => {
    for (
      const bot of [
        "Claude Code <claude-code@anthropic.com>",
        "Copilot <175728472+Copilot@users.noreply.github.com>",
        "copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>",
        "gemini-code-assist[bot] <176961590+gemini-code-assist[bot]@users.noreply.github.com>",
        "Cursor Agent <cursoragent@cursor.com>",
        "Codex <codex@openai.com>",
        "Amazon Q Developer <amazon-q-developer@example.com>",
      ]
    ) {
      assert.equal(stripAiCoAuthors(`Fix\n\nCo-Authored-By: ${bot}`), "Fix", bot);
    }
  });

  it("strips Cursor co-author", () => {
    const msg = `Add test

Co-authored-by: Cursor <cursor@cursor.com>`;
    assert.equal(stripAiCoAuthors(msg), "Add test");
  });
});
