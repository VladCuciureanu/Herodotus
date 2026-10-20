import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { parse as parseToml } from "smol-toml";
import { parseCli } from "../src/cli.ts";
import { parseSchedule } from "../src/config.ts";
import { runInit } from "../src/init.ts";

describe("parseSchedule", () => {
  it("only sets the fields that were provided", () => {
    assert.deepEqual(parseSchedule({ end: "17:30" }), { end: 17 * 60 + 30 });
    assert.deepEqual(parseSchedule({}), {});
  });

  it("parses every field", () => {
    const s = parseSchedule({
      start: "08:15",
      end: "16:00",
      timezone: "Asia/Tokyo",
      allowedDays: ["Mon", "friday"],
      startDate: "2024-03-01T09:00:00Z",
    });
    assert.equal(s.start, 8 * 60 + 15);
    assert.equal(s.end, 16 * 60);
    assert.equal(s.timezone, "Asia/Tokyo");
    assert.deepEqual(s.allowedDays, [1, 5]);
    assert.deepEqual(s.anchor, {
      type: "start",
      date: new Date("2024-03-01T09:00:00Z"),
    });
  });

  it("rejects both start and end dates", () => {
    assert.throws(
      () => parseSchedule({ startDate: "2024-01-01", endDate: "2024-02-01" }),
      /Cannot specify both/,
    );
  });
});

describe("parseCli merges config file and CLI flags", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "herodotus-config-"));
    writeFileSync(
      join(dir, ".herodotus.toml"),
      `[[identity]]
name = "File Author"
email = "file@example.com"

[schedule]
start = "10:00"
end = "16:00"
timezone = "Europe/Bucharest"
allowedDays = ["Sat", "Sun"]
endDate = "2024-06-01T12:00:00Z"
`,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the file schedule when no CLI schedule flags are given", async () => {
    const config = await parseCli(["-b", "main", dir]);
    assert.ok(config);
    assert.equal(config.schedule.start, 10 * 60);
    assert.equal(config.schedule.end, 16 * 60);
    assert.equal(config.schedule.timezone, "Europe/Bucharest");
    assert.deepEqual(config.schedule.allowedDays, [6, 0]);
    assert.deepEqual(config.identities, [{ name: "File Author", email: "file@example.com" }]);
  });

  it("a single CLI flag overrides only its own field", async () => {
    const config = await parseCli(["-b", "main", "--end", "20:00", dir]);
    assert.ok(config);
    assert.equal(config.schedule.start, 10 * 60);
    assert.equal(config.schedule.end, 20 * 60);
    assert.equal(config.schedule.timezone, "Europe/Bucharest");
    assert.deepEqual(config.schedule.allowedDays, [6, 0]);
    assert.deepEqual(config.schedule.anchor, {
      type: "end",
      date: new Date("2024-06-01T12:00:00Z"),
    });
  });

  it("a CLI date anchor replaces the file anchor", async () => {
    const config = await parseCli(["-b", "main", "--start-date", "2024-01-01T09:00:00Z", dir]);
    assert.ok(config);
    assert.deepEqual(config.schedule.anchor, {
      type: "start",
      date: new Date("2024-01-01T09:00:00Z"),
    });
    assert.equal(config.schedule.timezone, "Europe/Bucharest");
  });

  it("CLI identities override file identities", async () => {
    const config = await parseCli(["-b", "main", "-i", "Cli:cli@example.com", dir]);
    assert.ok(config);
    assert.deepEqual(config.identities, [{ name: "Cli", email: "cli@example.com" }]);
  });
});

describe("config file validation", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "herodotus-validate-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function rejectsFile(content: string, pattern: RegExp): Promise<void> {
    writeFileSync(join(dir, ".herodotus.toml"), content);
    await assert.rejects(parseCli(["-i", "A:a@example.com", "-b", "main", dir]), (err: Error) => {
      assert.ok(err.message.startsWith(join(dir, ".herodotus.toml")), err.message);
      assert.match(err.message, pattern);
      assert.doesNotMatch(err.message, /\n/);
      return true;
    });
  }

  it("rejects unknown top-level and schedule keys", async () => {
    await rejectsFile('branch = "main"\n', /unknown key "branch"/);
    await rejectsFile('[schedule]\nstrat = "09:00"\n', /unknown key "schedule\.strat"/);
    await rejectsFile(
      '[[identity]]\nname = "A"\nemail = "a@x"\nmail = "b"\n',
      /identity\[0\]\.mail/,
    );
  });

  it("rejects identities without a name or email", async () => {
    await rejectsFile('[[identity]]\nname = "A"\n', /#1 needs a non-empty name and email/);
    await rejectsFile(
      '[[identity]]\nname = "A"\nemail = "a@x"\n[[identity]]\nemail = "b@x"\n',
      /#2 needs/,
    );
    await rejectsFile('[[identity]]\nname = ""\nemail = "a@x"\n', /#1 needs/);
    await rejectsFile(
      '[[identity]]\nname = 1\nemail = "a@x"\n',
      /"identity\[0\]\.name" must be a string/,
    );
    await rejectsFile('identity = "A"\n', /\[\[identity\]\] tables/);
  });

  it("rejects values of the wrong type", async () => {
    await rejectsFile("schedule = 1\n", /"schedule" must be a table/);
    await rejectsFile("[schedule]\nstart = 9\n", /"schedule\.start" must be a string/);
    await rejectsFile('[schedule]\nallowedDays = "Mon"\n', /allowedDays" must be an array/);
    await rejectsFile("[schedule]\nendDate = 5\n", /"schedule\.endDate" must be a date/);
    await rejectsFile('[schedule]\nend = "25:00"\n', /Invalid time/);
  });

  it("reports TOML syntax errors on one line with a position", async () => {
    await rejectsFile("a = = 1\n", /:1:\d+: Invalid TOML document/);
  });

  it("accepts unquoted TOML date-times", async () => {
    writeFileSync(join(dir, ".herodotus.toml"), "[schedule]\nendDate = 2024-06-01T12:00:00Z\n");
    const config = await parseCli(["-i", "A:a@example.com", "-b", "main", dir]);
    assert.deepEqual(config?.schedule.anchor, {
      type: "end",
      date: new Date("2024-06-01T12:00:00Z"),
    });
  });
});

describe("library functions do not exit the process", () => {
  it("parseCli returns null for --help instead of exiting", async () => {
    assert.equal(await parseCli(["--help"]), null);
  });

  it("runInit throws when the config file already exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "herodotus-init-"));
    try {
      writeFileSync(join(dir, ".herodotus.toml"), "");
      await assert.rejects(runInit(dir), /already exists/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit", () => {
  it("escapes quotes and backslashes in the git identity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "herodotus-init-"));
    const name = String.raw`Ada "Countess" \ Lovelace`;
    try {
      for (const args of [
        ["init", "-q"],
        ["config", "user.name", name],
        ["config", "user.email", "ada@example.com"],
      ]) {
        assert.equal(spawnSync("git", args, { cwd: dir }).status, 0);
      }
      await runInit(dir);
      const toml = parseToml(readFileSync(join(dir, ".herodotus.toml"), "utf8"));
      assert.deepEqual({ ...(toml.identity as object[])[0] }, { name, email: "ada@example.com" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
