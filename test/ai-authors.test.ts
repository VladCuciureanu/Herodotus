import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { stripAiCoAuthors } from "../src/ai-authors.ts";

describe("stripAiCoAuthors", () => {
  it("strips Claude co-author", () => {
    const msg = `Fix login bug

Co-Authored-By: Claude <noreply@anthropic.com>`;
    expect(stripAiCoAuthors(msg)).toBe("Fix login bug");
  });

  it("strips Copilot co-author", () => {
    const msg = `Add feature

Co-Authored-By: GitHub Copilot <noreply@github.com>`;
    expect(stripAiCoAuthors(msg)).toBe("Add feature");
  });

  it("keeps human co-author", () => {
    const msg = `Refactor auth

Co-Authored-By: Alice <alice@example.com>`;
    expect(stripAiCoAuthors(msg)).toBe(msg);
  });

  it("strips AI but keeps human", () => {
    const msg = `Update docs

Co-Authored-By: Alice <alice@example.com>
Co-Authored-By: Claude <noreply@anthropic.com>`;
    expect(stripAiCoAuthors(msg)).toBe(`Update docs

Co-Authored-By: Alice <alice@example.com>`);
  });

  it("handles message with no trailers", () => {
    const msg = "Simple commit message";
    expect(stripAiCoAuthors(msg)).toBe(msg);
  });

  it("strips ChatGPT co-author", () => {
    const msg = `Fix bug

Co-Authored-By: ChatGPT <chatgpt@openai.com>`;
    expect(stripAiCoAuthors(msg)).toBe("Fix bug");
  });

  it("strips Cursor co-author", () => {
    const msg = `Add test

Co-authored-by: Cursor <cursor@cursor.com>`;
    expect(stripAiCoAuthors(msg)).toBe("Add test");
  });
});
