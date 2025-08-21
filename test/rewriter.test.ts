import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rewrite } from "../src/rewriter";
import type { HerodotusConfig } from "../src/types";

function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "herodotus-test-"));
  git(["init", "-b", "main"], dir);
  git(["config", "user.name", "Test User"], dir);
  git(["config", "user.email", "test@example.com"], dir);

  // Create commits with AI co-author trailers
  Bun.spawnSync(["bash", "-c", `echo "file1" > file1.txt`], { cwd: dir });
  git(["add", "file1.txt"], dir);
  git(["commit", "-m", "Initial commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>", "--date", "2024-01-08T03:00:00+0000"], dir);

  Bun.spawnSync(["bash", "-c", `echo "file2" > file2.txt`], { cwd: dir });
  git(["add", "file2.txt"], dir);
  git(["commit", "-m", "Add feature\n\nCo-Authored-By: Alice <alice@example.com>", "--date", "2024-01-08T04:00:00+0000"], dir);

  Bun.spawnSync(["bash", "-c", `echo "file3" > file3.txt`], { cwd: dir });
  git(["add", "file3.txt"], dir);
  git(["commit", "-m", "Fix bug\n\nCo-Authored-By: GitHub Copilot <noreply@github.com>", "--date", "2024-01-09T02:30:00+0000"], dir);

  return dir;
}

describe("rewriter", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("dry run reports changes without modifying repo", () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule: { start: 9 * 60, end: 18 * 60, timezone: "UTC", workdays: true, weekends: false, futureDates: true },
      inPlace: false,
      dryRun: true,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    return rewrite(config).then((changes) => {
      expect(changes.length).toBe(3);
      // Verify original repo is untouched
      const log = git(["log", "--oneline"], repoDir);
      expect(log).toContain("Fix bug");
      // Branch should not exist
      expect(() => git(["rev-parse", "herodotus/main"], repoDir)).toThrow();
    });
  });

  test("rewrites to new branch with correct identity", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule: { start: 9 * 60, end: 18 * 60, timezone: "UTC", workdays: true, weekends: false, futureDates: true },
      inPlace: false,
      dryRun: false,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    await rewrite(config);

    // Check the new branch exists
    const branches = git(["branch"], repoDir);
    expect(branches).toContain("herodotus/main");

    // Check author on new branch
    const author = git(["log", "--format=%an <%ae>", "herodotus/main"], repoDir);
    const lines = author.split("\n");
    for (const line of lines) {
      expect(line).toBe("New Author <new@example.com>");
    }
  });

  test("strips AI co-authors but keeps human ones", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule: { start: 9 * 60, end: 18 * 60, timezone: "UTC", workdays: true, weekends: false, futureDates: true },
      inPlace: false,
      dryRun: false,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    await rewrite(config);

    // Check commit messages on new branch
    const messages = git(["log", "--format=%B", "herodotus/main"], repoDir);

    // Claude co-author should be stripped
    expect(messages).not.toContain("noreply@anthropic.com");
    // Copilot co-author should be stripped
    expect(messages).not.toContain("noreply@github.com");
    // Human co-author should remain
    expect(messages).toContain("Alice <alice@example.com>");
  });

  test("timestamps are within work hours", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule: { start: 9 * 60, end: 18 * 60, timezone: "UTC", workdays: true, weekends: false, futureDates: true },
      inPlace: false,
      dryRun: false,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    await rewrite(config);

    const dates = git(["log", "--format=%ai", "herodotus/main"], repoDir);
    for (const line of dates.split("\n").filter(Boolean)) {
      const d = new Date(line);
      const hours = d.getUTCHours();
      expect(hours).toBeGreaterThanOrEqual(9);
      expect(hours).toBeLessThan(18);
    }
  });
});
