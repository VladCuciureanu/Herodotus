import { describe, it, beforeEach, afterEach } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewrite } from "../src/rewriter.ts";
import type { HerodotusConfig } from "../src/types.ts";

function git(args: string[], cwd: string): string {
  const result = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function writeFile(path: string, content: string): void {
  Deno.writeTextFileSync(path, content);
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "herodotus-test-"));
  git(["init", "-b", "main"], dir);
  git(["config", "user.name", "Test User"], dir);
  git(["config", "user.email", "test@example.com"], dir);

  writeFile(join(dir, "file1.txt"), "file1\n");
  git(["add", "file1.txt"], dir);
  git(["commit", "-m", "Initial commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>", "--date", "2024-01-08T03:00:00+0000"], dir);

  writeFile(join(dir, "file2.txt"), "file2\n");
  git(["add", "file2.txt"], dir);
  git(["commit", "-m", "Add feature\n\nCo-Authored-By: Alice <alice@example.com>", "--date", "2024-01-08T04:00:00+0000"], dir);

  writeFile(join(dir, "file3.txt"), "file3\n");
  git(["add", "file3.txt"], dir);
  git(["commit", "-m", "Fix bug\n\nCo-Authored-By: GitHub Copilot <noreply@github.com>", "--date", "2024-01-09T02:30:00+0000"], dir);

  return dir;
}

const schedule = { start: 9 * 60, end: 18 * 60, timezone: "UTC", allowedDays: [1, 2, 3, 4, 5], anchor: { type: "start" as const, date: new Date("2024-01-08T09:00:00Z") } };

describe("rewriter", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("dry run reports changes without modifying repo", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule,
      inPlace: false,
      dryRun: true,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    const changes = await rewrite(config);
    expect(changes.length).toBe(3);
    const log = git(["log", "--oneline"], repoDir);
    expect(log).toContain("Fix bug");
    expect(() => git(["rev-parse", "herodotus/main"], repoDir)).toThrow();
  });

  it("rewrites to new branch with correct identity", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule,
      inPlace: false,
      dryRun: false,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    await rewrite(config);

    const branches = git(["branch"], repoDir);
    expect(branches).toContain("herodotus/main");

    const author = git(["log", "--format=%an <%ae>", "herodotus/main"], repoDir);
    const lines = author.split("\n");
    for (const line of lines) {
      expect(line).toBe("New Author <new@example.com>");
    }
  });

  it("strips AI co-authors but keeps human ones", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule,
      inPlace: false,
      dryRun: false,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
    };

    await rewrite(config);

    const messages = git(["log", "--format=%B", "herodotus/main"], repoDir);
    expect(messages).not.toContain("noreply@anthropic.com");
    expect(messages).not.toContain("noreply@github.com");
    expect(messages).toContain("Alice <alice@example.com>");
  });

  it("timestamps are within work hours", async () => {
    const config: HerodotusConfig = {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule,
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
