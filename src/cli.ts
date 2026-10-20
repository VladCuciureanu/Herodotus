import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildConfig, type ConfigOverrides, loadConfig, parseSchedule } from "./config.ts";
import type { HerodotusConfig, Identity } from "./types.ts";

/** A command-line mistake that parseArgs itself does not catch. */
export class UsageError extends Error {}

/** Resolve the optional <repo-path> positional, refusing any extra ones. */
function repoPathFrom(positionals: string[]): string {
  if (positionals.length > 1) {
    throw new UsageError(`Unexpected argument: "${positionals[1]}"`);
  }
  return resolve(positionals[0] ?? ".");
}

function parseIdentity(s: string): Identity {
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx === -1) {
    throw new Error(`Invalid identity format: "${s}". Expected "Name:email@example.com"`);
  }
  return {
    name: s.slice(0, colonIdx).trim(),
    email: s.slice(colonIdx + 1).trim(),
  };
}

/**
 * Parse CLI arguments into a config. Returns null when --help was requested;
 * the caller decides how to show usage and exit.
 */
export async function parseCli(argv: string[]): Promise<HerodotusConfig | null> {
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

  if (values.help) return null;

  const repoPath = repoPathFrom(positionals);

  const fileConfig = await loadConfig(values.config, repoPath);

  const cliArgs: ConfigOverrides = {};

  if (values.identity && values.identity.length > 0) {
    cliArgs.identities = values.identity.map(parseIdentity);
  }

  if (values.branch) cliArgs.branch = values.branch;
  if (values["in-place"]) cliArgs.inPlace = true;
  if (values["dry-run"]) cliArgs.dryRun = true;
  if (values.seed !== undefined) {
    const seed = Number(values.seed);
    if (!/^\d+$/.test(values.seed) || !Number.isSafeInteger(seed)) {
      throw new Error(`Invalid seed: "${values.seed}". Must be a non-negative integer`);
    }
    cliArgs.seed = seed;
  }

  cliArgs.schedule = parseSchedule({
    start: values.start,
    end: values.end,
    timezone: values.timezone,
    allowedDays: values["allowed-days"]?.split(","),
    startDate: values["start-date"],
    endDate: values["end-date"],
  });

  return buildConfig(cliArgs, fileConfig, repoPath);
}

export interface InitOptions {
  repoPath: string;
  configPath?: string;
}

/**
 * Parse the arguments after `init`. Returns null when --help was requested.
 */
export function parseInitCli(argv: string[]): InitOptions | null {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) return null;
  return { repoPath: repoPathFrom(positionals), configPath: values.config };
}

export const USAGE = `herodotus — rewrite git history with plausible identities & timestamps

Usage: herodotus [options] [<repo-path>]
       herodotus init [-c <file>] [<repo-path>]

Options:
  -i, --identity <name:email>  Identity to use (repeatable)
  -c, --config <file>          Config file (default: .herodotus.toml)
  -b, --branch <ref>           Branch or other ref to rewrite (default: current branch)
  --start <HH:MM>              Workday start (default: 09:00)
  --end <HH:MM>                Workday end (default: 18:00)
  --timezone <tz>              IANA timezone (default: system)
  -d, --allowed-days <days>    Comma-separated days (default: Mon,Tue,Wed,Thu,Fri,Sat)
  --start-date <date>          First commit lands on this date (build forward)
  --end-date <date>            Last commit lands on this date (build backward, default: now)
  --in-place                   Rewrite branch in-place (default: new branch)
  --dry-run                    Show changes without modifying
  --seed <number>              PRNG seed for reproducibility
  -h, --help                   Show this help`;

export function printUsage(): void {
  console.log(USAGE);
}
