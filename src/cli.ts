import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { HerodotusConfig, Identity } from "./types.ts";
import {
  buildConfig,
  DEFAULT_ALLOWED_DAYS,
  loadConfigAsync,
  parseAnchor,
  parseDays,
  parseTime,
} from "./config.ts";

function parseIdentity(s: string): Identity {
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      `Invalid identity format: "${s}". Expected "Name:email@example.com"`,
    );
  }
  return {
    name: s.slice(0, colonIdx).trim(),
    email: s.slice(colonIdx + 1).trim(),
  };
}

export async function parseCli(argv: string[]): Promise<HerodotusConfig> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      identity: { type: "string", short: "i", multiple: true },
      config: { type: "string", short: "c" },
      branch: { type: "string", short: "b" },
      start: { type: "string" },
      end: { type: "string" },
      timezone: { type: "string" },
      "allowed-days": { type: "string", short: "d" },
      "start-date": { type: "string" },
      "end-date": { type: "string" },
      "in-place": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      seed: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    printUsage();
    Deno.exit(0);
  }

  const repoPath = resolve(positionals[0] ?? ".");

  const fileConfig = await loadConfigAsync(values.config, repoPath);

  const cliArgs: Partial<HerodotusConfig> = {};

  if (values.identity && values.identity.length > 0) {
    cliArgs.identities = values.identity.map(parseIdentity);
  }

  if (values.branch) cliArgs.branch = values.branch;
  if (values["in-place"]) cliArgs.inPlace = true;
  if (values["dry-run"]) cliArgs.dryRun = true;
  if (values.seed) {
    const seed = parseInt(values.seed, 10);
    if (!Number.isFinite(seed) || seed < 0) {
      throw new Error(
        `Invalid seed: "${values.seed}". Must be a non-negative integer`,
      );
    }
    cliArgs.seed = seed;
  }

  if (
    values.start || values.end || values.timezone || values["allowed-days"] ||
    values["start-date"] || values["end-date"]
  ) {
    cliArgs.schedule = {
      start: values.start ? parseTime(values.start) : 9 * 60,
      end: values.end ? parseTime(values.end) : 18 * 60,
      timezone: values.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      allowedDays: values["allowed-days"]
        ? parseDays(values["allowed-days"].split(","))
        : DEFAULT_ALLOWED_DAYS,
      anchor: parseAnchor(values["start-date"], values["end-date"]),
    };
  }

  return buildConfig(cliArgs, fileConfig, repoPath);
}

function printUsage(): void {
  console.log(
    `herodotus — rewrite git history with plausible identities & timestamps

Usage: herodotus [options] [<repo-path>]
       herodotus init [<repo-path>]

Options:
  -i, --identity <name:email>  Identity to use (repeatable)
  -c, --config <file>          Config file (default: .herodotus.toml)
  -b, --branch <ref>           Branch to rewrite (default: HEAD)
  --start <HH:MM>              Workday start (default: 09:00)
  --end <HH:MM>                Workday end (default: 18:00)
  --timezone <tz>               IANA timezone (default: system)
  -d, --allowed-days <days>      Comma-separated days (default: Mon,Tue,Wed,Thu,Fri,Sat)
  --start-date <date>           First commit lands on this date (build forward)
  --end-date <date>             Last commit lands on this date (build backward, default: now)
  --in-place                    Rewrite branch in-place (default: new branch)
  --dry-run                     Show changes without modifying
  --seed <number>               PRNG seed for reproducibility
  -h, --help                    Show this help`,
  );
}
