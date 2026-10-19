import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capitalizeConventionalCommit } from "../src/commit-message.ts";

describe("capitalizeConventionalCommit", () => {
  it("capitalizes after feat:", () => {
    assert.equal(capitalizeConventionalCommit("feat: add login"), "feat: Add login");
  });

  it("capitalizes after fix:", () => {
    assert.equal(capitalizeConventionalCommit("fix: resolve crash"), "fix: Resolve crash");
  });

  it("capitalizes with scope", () => {
    assert.equal(capitalizeConventionalCommit("feat(auth): add login"), "feat(auth): Add login");
  });

  it("leaves already capitalized alone", () => {
    assert.equal(capitalizeConventionalCommit("feat: Add login"), "feat: Add login");
  });

  it("leaves non-conventional commits alone", () => {
    assert.equal(capitalizeConventionalCommit("Initial commit"), "Initial commit");
  });

  it("handles chore, docs, refactor, etc.", () => {
    assert.equal(capitalizeConventionalCommit("chore: update deps"), "chore: Update deps");
    assert.equal(capitalizeConventionalCommit("docs: add readme"), "docs: Add readme");
    assert.equal(capitalizeConventionalCommit("refactor: extract helper"), "refactor: Extract helper");
  });

  it("only affects first line", () => {
    const msg = "feat: add login\n\nsome body text";
    assert.equal(capitalizeConventionalCommit(msg), "feat: Add login\n\nsome body text");
  });
});
