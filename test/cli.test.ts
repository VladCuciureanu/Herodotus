import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, it } from "node:test";

const mainScript = join(import.meta.dirname, "..", "src", "main.ts");

function herodotus(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [mainScript, ...args], { cwd, encoding: "utf8" });
}

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Asserts a failed run printed exactly one `herodotus:` line on stderr. */
function assertError(result: ReturnType<typeof herodotus>, pattern: RegExp): void {
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^herodotus: [^\n]+\n$/);
  assert.match(result.stderr, pattern);
}

describe("CLI errors", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "herodotus-cli-"));
    git(["init", "-q", "-b", "main"], repoDir);
    git(["config", "user.name", "Test User"], repoDir);
    git(["config", "user.email", "test@example.com"], repoDir);
    git(["commit", "-q", "--allow-empty", "-m", "Initial"], repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("reports an unknown flag as a one-line usage error", () => {
    assertError(herodotus(["--bogus", repoDir]), /Unknown option '--bogus'.*See herodotus --help/);
  });

  it("calls a missing -b a ref, since any ref is accepted", () => {
    assertError(
      herodotus(["-b", "origin/nope", repoDir]),
      /^herodotus: ref "origin\/nope" does not exist/,
    );
  });
});
