import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, it } from "node:test";
import { rewrite } from "../src/rewriter.ts";
import type { HerodotusConfig } from "../src/types.ts";

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function writeFile(path: string, content: string): void {
  writeFileSync(path, content);
}

function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "herodotus-test-"));
  git(["init", "-b", "main"], dir);
  git(["config", "user.name", "Test User"], dir);
  git(["config", "user.email", "test@example.com"], dir);

  writeFile(join(dir, "file1.txt"), "file1\n");
  git(["add", "file1.txt"], dir);
  git(
    [
      "commit",
      "-m",
      "Initial commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      "--date",
      "2024-01-08T03:00:00+0000",
    ],
    dir,
  );

  writeFile(join(dir, "file2.txt"), "file2\n");
  git(["add", "file2.txt"], dir);
  git(
    [
      "commit",
      "-m",
      "Add feature\n\nCo-Authored-By: Alice <alice@example.com>",
      "--date",
      "2024-01-08T04:00:00+0000",
    ],
    dir,
  );

  writeFile(join(dir, "file3.txt"), "file3\n");
  git(["add", "file3.txt"], dir);
  git(
    [
      "commit",
      "-m",
      "Fix bug\n\nCo-Authored-By: GitHub Copilot <noreply@github.com>",
      "--date",
      "2024-01-09T02:30:00+0000",
    ],
    dir,
  );

  return dir;
}

const schedule = {
  start: 9 * 60,
  end: 18 * 60,
  timezone: "UTC",
  allowedDays: [1, 2, 3, 4, 5],
  anchor: { type: "start" as const, date: new Date("2024-01-08T09:00:00Z") },
};

// Binary content that also contains fast-export command keywords, to make sure
// the stream parser never interprets blob bytes as commands.
const BINARY = Buffer.concat([
  Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0x0a]),
  Buffer.from("\ncommit refs/heads/main\ndata 3\nabc\nreset x\n"),
  Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) % 256)),
]);

describe("rewriter", () => {
  let repoDir: string;

  function makeConfig(overrides: Partial<HerodotusConfig> = {}): HerodotusConfig {
    return {
      identities: [{ name: "New Author", email: "new@example.com" }],
      schedule,
      inPlace: false,
      dryRun: false,
      branch: "main",
      repoPath: repoDir,
      backup: false,
      seed: 42,
      ...overrides,
    };
  }

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("dry run reports changes without modifying repo", async () => {
    const { changes } = await rewrite(makeConfig({ dryRun: true }));
    assert.equal(changes.length, 3);
    const log = git(["log", "--oneline"], repoDir);
    assert.ok(log.includes("Fix bug"));
    assert.throws(() => git(["rev-parse", "herodotus/main"], repoDir));
  });

  it("rewrites to new branch with correct identity", async () => {
    await rewrite(makeConfig());

    const branches = git(["branch"], repoDir);
    assert.ok(branches.includes("herodotus/main"));

    const author = git(["log", "--format=%an <%ae>", "herodotus/main"], repoDir);
    const lines = author.split("\n");
    for (const line of lines) {
      assert.equal(line, "New Author <new@example.com>");
    }
  });

  it("strips AI co-authors but keeps human ones", async () => {
    await rewrite(makeConfig());

    const messages = git(["log", "--format=%B", "herodotus/main"], repoDir);
    assert.ok(!messages.includes("noreply@anthropic.com"));
    assert.ok(!messages.includes("noreply@github.com"));
    assert.ok(messages.includes("Alice <alice@example.com>"));
  });

  it("timestamps are within work hours", async () => {
    await rewrite(makeConfig());

    const dates = git(["log", "--format=%ai", "herodotus/main"], repoDir);
    for (const line of dates.split("\n").filter(Boolean)) {
      const d = new Date(line);
      const hours = d.getUTCHours();
      assert.ok(hours >= 9);
      assert.ok(hours < 18);
    }
  });

  it("preserves non-UTF-8 binary blobs in new-branch mode", async () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0x0a]);
    writeFileSync(join(repoDir, "blob.bin"), binary);
    git(["add", "blob.bin"], repoDir);
    git(["commit", "-m", "Add binary", "--date", "2024-01-09T03:00:00+0000"], repoDir);
    const originalHead = git(["rev-parse", "main"], repoDir);

    await rewrite(makeConfig());

    assert.equal(
      git(["rev-parse", "herodotus/main:blob.bin"], repoDir),
      git(["rev-parse", "main:blob.bin"], repoDir),
    );
    assert.equal(git(["rev-parse", "main"], repoDir), originalHead);
  });

  it("rewrites in place and stores a backup ref", async () => {
    writeFileSync(join(repoDir, "blob.bin"), BINARY);
    git(["add", "blob.bin"], repoDir);
    git(["commit", "-m", "Add binary", "--date", "2024-01-09T03:00:00+0000"], repoDir);
    const originalHead = git(["rev-parse", "main"], repoDir);
    const originalBlob = git(["rev-parse", "main:blob.bin"], repoDir);
    const backup = "refs/original/herodotus/main";

    await rewrite(makeConfig({ inPlace: true, backup }));

    assert.equal(git(["rev-parse", backup], repoDir), originalHead);
    assert.notEqual(git(["rev-parse", "main"], repoDir), originalHead);
    assert.equal(git(["rev-parse", "main:blob.bin"], repoDir), originalBlob);
    assert.equal(git(["rev-list", "--count", "main"], repoDir), "4");
    assert.throws(() => git(["rev-parse", "--verify", "herodotus/main"], repoDir));
    const authors = git(["log", "--format=%an <%ae>", "main"], repoDir);
    for (const line of authors.split("\n")) {
      assert.equal(line, "New Author <new@example.com>");
    }
    assert.equal(git(["status", "--porcelain"], repoDir), "");
  });

  it("keeps the first backup when rewriting in place twice", async () => {
    const originalHead = git(["rev-parse", "main"], repoDir);
    const backup = "refs/original/herodotus/main";

    await rewrite(makeConfig({ inPlace: true, backup }));
    const firstRewrite = git(["rev-parse", "main"], repoDir);
    const second = await rewrite(makeConfig({ inPlace: true, backup, seed: 7 }));

    assert.equal(git(["rev-parse", backup], repoDir), originalHead);
    const refs = git(
      ["for-each-ref", "--format=%(refname) %(objectname)", "refs/original/"],
      repoDir,
    ).split("\n");
    assert.equal(refs.length, 2);
    const extra = refs.find((r) => !r.startsWith(`${backup} `));
    assert.match(extra ?? "", /^refs\/original\/herodotus\/main@\d+ /);
    const [extraRef, extraSha] = extra!.split(" ");
    assert.equal(extraSha, firstRewrite);
    assert.equal(second.backupRef, extraRef);
  });

  it("refuses an annotated tag in in-place mode and keeps the tag object", async () => {
    git(["tag", "-a", "v1", "-m", "release"], repoDir);
    const tagObject = git(["rev-parse", "refs/tags/v1"], repoDir);
    const backup = "refs/original/herodotus/v1";

    await assert.rejects(
      rewrite(makeConfig({ branch: "v1", inPlace: true, backup })),
      /annotated tag/,
    );

    assert.equal(git(["rev-parse", "refs/tags/v1"], repoDir), tagObject);
    assert.equal(git(["cat-file", "-t", "refs/tags/v1"], repoDir), "tag");
    assert.equal(git(["for-each-ref", "refs/original/"], repoDir), "");
  });

  it("refuses non-ref revisions in in-place mode", async () => {
    const head = git(["rev-parse", "main"], repoDir);
    await assert.rejects(
      rewrite(makeConfig({ branch: head, inPlace: true, backup: false })),
      /does not name a branch or other ref/,
    );
    git(["checkout", "-q", "--detach"], repoDir);
    await assert.rejects(
      rewrite(makeConfig({ branch: "HEAD", inPlace: true, backup: false })),
      /does not name a branch or other ref/,
    );
    assert.equal(git(["rev-parse", "main"], repoDir), head);
  });

  it("calls a name that is both a tag and a branch ambiguous", async () => {
    git(["branch", "dup"], repoDir);
    git(["tag", "dup"], repoDir);
    for (const inPlace of [false, true]) {
      await assert.rejects(
        rewrite(makeConfig({ branch: "dup", inPlace })),
        /ambiguous.*refs\/heads\/dup/s,
      );
    }
    await rewrite(makeConfig({ branch: "refs/heads/dup" }));
    assert.ok(git(["rev-parse", "--verify", "refs/heads/herodotus/dup"], repoDir));
  });

  it("re-encodes non-UTF-8 commit messages and keeps blobs byte-exact", async (t) => {
    // Latin-1 bytes in both the message and a file: only the message may change.
    const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0xff, 0x0a]); // "Café ÿ\n"
    writeFileSync(join(repoDir, "latin1.txt"), latin1);
    writeFileSync(join(repoDir, "blob.bin"), BINARY);
    git(["add", "latin1.txt", "blob.bin"], repoDir);
    const msgFile = join(repoDir, "..", `${repoDir.split(/[\\/]/).pop()}.msg`);
    writeFileSync(msgFile, Buffer.from("Caf\xe9 latin\n", "latin1"));
    try {
      git(
        [
          "-c",
          "i18n.commitEncoding=ISO-8859-1",
          "commit",
          "-F",
          msgFile,
          "--date",
          "2024-01-09T03:00:00+0000",
        ],
        repoDir,
      );
    } finally {
      rmSync(msgFile, { force: true });
    }
    const raw = spawnSync("git", ["cat-file", "commit", "main"], { cwd: repoDir });
    if (!/^encoding ISO-8859-1$/m.test(Buffer.from(raw.stdout).toString("latin1"))) {
      t.skip("local git did not record an ISO-8859-1 encoding header");
      return;
    }

    await rewrite(makeConfig());

    const rewritten = Buffer.from(
      spawnSync("git", ["cat-file", "commit", "herodotus/main"], { cwd: repoDir }).stdout,
    );
    assert.ok(!rewritten.includes("encoding "), rewritten.toString("latin1"));
    assert.ok(rewritten.includes(Buffer.from("\n\nCafé latin", "utf8")));
    assert.equal(
      git(["rev-parse", "herodotus/main^{tree}"], repoDir),
      git(["rev-parse", "main^{tree}"], repoDir),
    );
    for (const [path, bytes] of [
      ["latin1.txt", latin1],
      ["blob.bin", BINARY],
    ] as const) {
      const blob = spawnSync("git", ["cat-file", "blob", `herodotus/main:${path}`], {
        cwd: repoDir,
      });
      assert.ok(Buffer.from(blob.stdout).equals(bytes), path);
    }
  });

  it("never overwrites a non-branch source ref in default mode", async () => {
    const originalHead = git(["rev-parse", "main"], repoDir);
    git(["update-ref", "refs/remotes/origin/main", originalHead], repoDir);

    await rewrite(makeConfig({ branch: "origin/main" }));

    assert.equal(git(["rev-parse", "refs/remotes/origin/main"], repoDir), originalHead);
    assert.equal(git(["rev-parse", "main"], repoDir), originalHead);
    const target = "refs/heads/herodotus/origin/main";
    assert.notEqual(git(["rev-parse", target], repoDir), originalHead);
    assert.equal(git(["rev-list", "--count", target], repoDir), "3");
    const authors = git(["log", "--format=%an <%ae>", target], repoDir);
    for (const line of authors.split("\n")) {
      assert.equal(line, "New Author <new@example.com>");
    }
  });

  it("refuses an annotated tag in default mode", async () => {
    git(["tag", "-a", "v1", "-m", "release"], repoDir);
    const tagObject = git(["rev-parse", "refs/tags/v1"], repoDir);

    await assert.rejects(rewrite(makeConfig({ branch: "v1" })), /annotated tag/);

    assert.equal(git(["rev-parse", "refs/tags/v1"], repoDir), tagObject);
  });

  it("uses local work hours and offsets of a non-UTC timezone", async () => {
    await rewrite(
      makeConfig({
        schedule: { ...schedule, timezone: "Asia/Kolkata" },
      }),
    );

    // %ai prints each date in its own recorded offset: "YYYY-MM-DD HH:MM:SS +0530"
    const dates = git(["log", "--format=%ai", "herodotus/main"], repoDir);
    for (const line of dates.split("\n")) {
      const [, time, offset] = line.split(" ");
      assert.equal(offset, "+0530");
      const [h, m] = time.split(":").map(Number);
      const mins = h * 60 + m;
      assert.ok(mins >= 9 * 60 && mins < 18 * 60, `${line} outside 09-18`);
    }
  });
});

describe("herodotus CLI end to end", () => {
  const mainScript = join(import.meta.dirname, "..", "src", "main.ts");
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTestRepo();
    writeFileSync(join(repoDir, "blob.bin"), BINARY);
    git(["add", "blob.bin"], repoDir);
    git(["commit", "-m", "Add binary", "--date", "2024-01-09T03:00:00+0000"], repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("writes herodotus/<branch> with binary blobs intact by default", () => {
    const originalHead = git(["rev-parse", "main"], repoDir);
    const result = spawnSync(
      process.execPath,
      [
        mainScript,
        "-i",
        "Ada Lovelace:ada@example.com",
        "--timezone",
        "UTC",
        "--start-date",
        "2024-01-08T09:00:00Z",
        "--seed",
        "7",
        repoDir,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Rewrote 4 commit\(s\)/);

    assert.equal(git(["rev-parse", "main"], repoDir), originalHead);
    assert.equal(
      git(["rev-parse", "herodotus/main^{tree}"], repoDir),
      git(["rev-parse", "main^{tree}"], repoDir),
    );
    const blob = spawnSync("git", ["cat-file", "blob", "herodotus/main:blob.bin"], {
      cwd: repoDir,
    });
    assert.ok(Buffer.from(blob.stdout).equals(BINARY));
    const authors = git(["log", "--format=%an <%ae>", "herodotus/main"], repoDir);
    for (const line of authors.split("\n")) {
      assert.equal(line, "Ada Lovelace <ada@example.com>");
    }
  });

  it("reports a new timestamped backup ref on a second --in-place run", () => {
    const originalHead = git(["rev-parse", "main"], repoDir);
    const run = () =>
      spawnSync(
        process.execPath,
        [mainScript, "-i", "Ada Lovelace:ada@example.com", "--in-place", "--seed", "7", repoDir],
        { encoding: "utf8" },
      );

    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /stored at: refs\/original\/herodotus\/main\n/);
    const firstRewrite = git(["rev-parse", "main"], repoDir);

    const second = run();
    assert.equal(second.status, 0, second.stderr);
    const m = second.stdout.match(/stored at: (refs\/original\/herodotus\/main@\d+)\n/);
    assert.ok(m, second.stdout);
    assert.equal(git(["rev-parse", m[1]], repoDir), firstRewrite);
    assert.equal(git(["rev-parse", "refs/original/herodotus/main"], repoDir), originalHead);
  });

  it("writes -b origin/main to herodotus/origin/main, leaving the remote ref", () => {
    const originalHead = git(["rev-parse", "main"], repoDir);
    git(["update-ref", "refs/remotes/origin/main", originalHead], repoDir);
    const result = spawnSync(
      process.execPath,
      [
        mainScript,
        "-i",
        "Ada Lovelace:ada@example.com",
        "-b",
        "origin/main",
        "--seed",
        "7",
        repoDir,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /new branch herodotus\/origin\/main/);
    assert.equal(git(["rev-parse", "refs/remotes/origin/main"], repoDir), originalHead);
    assert.equal(
      git(["rev-parse", "refs/heads/herodotus/origin/main^{tree}"], repoDir),
      git(["rev-parse", "main^{tree}"], repoDir),
    );
  });
});
