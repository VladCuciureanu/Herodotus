import { describe, expect, test } from "bun:test";
import { capitalizeConventionalCommit } from "../src/commit-message";

describe("capitalizeConventionalCommit", () => {
  test("capitalizes after feat:", () => {
    expect(capitalizeConventionalCommit("feat: add login")).toBe("feat: Add login");
  });

  test("capitalizes after fix:", () => {
    expect(capitalizeConventionalCommit("fix: resolve crash")).toBe("fix: Resolve crash");
  });

  test("capitalizes with scope", () => {
    expect(capitalizeConventionalCommit("feat(auth): add login")).toBe("feat(auth): Add login");
  });

  test("leaves already capitalized alone", () => {
    expect(capitalizeConventionalCommit("feat: Add login")).toBe("feat: Add login");
  });

  test("leaves non-conventional commits alone", () => {
    expect(capitalizeConventionalCommit("Initial commit")).toBe("Initial commit");
  });

  test("handles chore, docs, refactor, etc.", () => {
    expect(capitalizeConventionalCommit("chore: update deps")).toBe("chore: Update deps");
    expect(capitalizeConventionalCommit("docs: add readme")).toBe("docs: Add readme");
    expect(capitalizeConventionalCommit("refactor: extract helper")).toBe("refactor: Extract helper");
  });

  test("only affects first line", () => {
    const msg = "feat: add login\n\nsome body text";
    expect(capitalizeConventionalCommit(msg)).toBe("feat: Add login\n\nsome body text");
  });
});
