import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { capitalizeConventionalCommit } from "../src/commit-message.ts";

describe("capitalizeConventionalCommit", () => {
  it("capitalizes after feat:", () => {
    expect(capitalizeConventionalCommit("feat: add login")).toBe("feat: Add login");
  });

  it("capitalizes after fix:", () => {
    expect(capitalizeConventionalCommit("fix: resolve crash")).toBe("fix: Resolve crash");
  });

  it("capitalizes with scope", () => {
    expect(capitalizeConventionalCommit("feat(auth): add login")).toBe("feat(auth): Add login");
  });

  it("leaves already capitalized alone", () => {
    expect(capitalizeConventionalCommit("feat: Add login")).toBe("feat: Add login");
  });

  it("leaves non-conventional commits alone", () => {
    expect(capitalizeConventionalCommit("Initial commit")).toBe("Initial commit");
  });

  it("handles chore, docs, refactor, etc.", () => {
    expect(capitalizeConventionalCommit("chore: update deps")).toBe("chore: Update deps");
    expect(capitalizeConventionalCommit("docs: add readme")).toBe("docs: Add readme");
    expect(capitalizeConventionalCommit("refactor: extract helper")).toBe("refactor: Extract helper");
  });

  it("only affects first line", () => {
    const msg = "feat: add login\n\nsome body text";
    expect(capitalizeConventionalCommit(msg)).toBe("feat: Add login\n\nsome body text");
  });
});
