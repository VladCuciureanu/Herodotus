import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, it } from "node:test";
import { parseCli, USAGE } from "../src/cli.ts";

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

describe("parseCli", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "herodotus-parse-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  const parse = (...args: string[]) =>
    parseCli(["-i", "A:a@example.com", "-b", "main", ...args, repoDir]);

  it("accepts a non-negative integer seed", async () => {
    assert.equal((await parse("--seed", "0"))?.seed, 0);
    assert.equal((await parse("--seed", "42"))?.seed, 42);
  });

  it("rejects seeds that are not plain non-negative integers", async () => {
    for (const seed of ["12abc", "1.5", "-1", "", " 7", "1e3", "0x10", "9007199254740993"]) {
      await assert.rejects(parse(`--seed=${seed}`), /Invalid seed/, seed);
    }
  });
});

describe("--help", () => {
  it("aligns every option description in one column", () => {
    const options = USAGE.split("\n").filter((line) => /^ {2}-/.test(line));
    assert.ok(options.length > 10);
    const columns = new Set(options.map((line) => line.search(/\S+(?: \S+)*$/)));
    assert.equal(columns.size, 1, options.join("\n"));
  });
});
