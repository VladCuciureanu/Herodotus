import { parse as parseToml } from "smol-toml";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HerodotusConfig, ScheduleConfig } from "./types.ts";
import { getCurrentBranch, getDefaultIdentity } from "./utils.ts";

export function parseTime(s: string): number {
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time format: "${s}". Expected "HH:MM"`);
  const h = parseInt(match[1]);
  const m = parseInt(match[2]);
  if (h > 23 || m > 59) {
    throw new Error(`Invalid time: "${s}". Hours must be 0-23, minutes 0-59`);
  }
  return h * 60 + m;
}

const DAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const DEFAULT_ALLOWED_DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat

export function parseAnchor(
  startDate?: string,
  endDate?: string,
): ScheduleConfig["anchor"] {
  if (startDate && endDate) {
    throw new Error(
      "Cannot specify both --start-date and --end-date. Choose one.",
    );
  }
  if (startDate) {
    const d = new Date(startDate);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid start date: "${startDate}"`);
    }
    return { type: "start", date: d };
  }
  if (endDate) {
    const d = new Date(endDate);
    if (isNaN(d.getTime())) throw new Error(`Invalid end date: "${endDate}"`);
    return { type: "end", date: d };
  }
  return { type: "end", date: new Date() };
}

export function parseDays(input: string[]): number[] {
  return input.map((d) => {
    const n = DAY_MAP[d.toLowerCase()];
    if (n === undefined) {
      throw new Error(`Invalid day: "${d}". Use Mon, Tue, etc.`);
    }
    return n;
  });
}

/** Raw, unparsed schedule options as they appear in TOML or on the CLI. */
export interface ScheduleInput {
  start?: string;
  end?: string;
  timezone?: string;
  allowedDays?: string[];
  startDate?: string;
  endDate?: string;
}

/**
 * Parse raw schedule options. Only the fields that were provided are set on
 * the result, so partial schedules from different sources can be merged.
 */
export function parseSchedule(input: ScheduleInput): Partial<ScheduleConfig> {
  const schedule: Partial<ScheduleConfig> = {};
  if (input.start) schedule.start = parseTime(input.start);
  if (input.end) schedule.end = parseTime(input.end);
  if (input.timezone) schedule.timezone = input.timezone;
  if (input.allowedDays) schedule.allowedDays = parseDays(input.allowedDays);
  if (input.startDate || input.endDate) {
    schedule.anchor = parseAnchor(input.startDate, input.endDate);
  }
  return schedule;
}

/**
 * Config from a single source (file or CLI). The schedule may be partial so
 * that sources can be merged field by field.
 */
export type ConfigOverrides = Omit<Partial<HerodotusConfig>, "schedule"> & {
  schedule?: Partial<ScheduleConfig>;
};

interface TomlConfig {
  identity?: Array<{ name: string; email: string }>;
  schedule?: ScheduleInput;
}

export async function loadConfigAsync(
  configPath: string | undefined,
  repoPath: string,
): Promise<ConfigOverrides> {
  const filePath = resolve(repoPath, configPath ?? ".herodotus.toml");
  if (!existsSync(filePath)) return {};

  const content = await readFile(filePath, "utf8");
  const toml = parseToml(content) as unknown as TomlConfig;

  const result: ConfigOverrides = {};

  if (toml.identity && toml.identity.length > 0) {
    result.identities = toml.identity.map((i) => ({
      name: i.name,
      email: i.email,
    }));
  }

  if (toml.schedule) {
    result.schedule = parseSchedule(toml.schedule);
  }

  return result;
}

export function buildDefaultSchedule(): ScheduleConfig {
  return {
    start: 9 * 60,
    end: 18 * 60,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    allowedDays: DEFAULT_ALLOWED_DAYS,
    anchor: { type: "end", date: new Date() },
  };
}

export function buildConfig(
  cliArgs: ConfigOverrides,
  fileConfig: ConfigOverrides,
  repoPath: string,
): HerodotusConfig {
  const identities = cliArgs.identities ??
    fileConfig.identities ?? [getDefaultIdentity(repoPath)];

  // Each source only carries the fields it set, so later sources override
  // earlier ones field by field.
  const schedule: ScheduleConfig = {
    ...buildDefaultSchedule(),
    ...fileConfig.schedule,
    ...cliArgs.schedule,
  };

  const branch = cliArgs.branch ?? fileConfig.branch ??
    getCurrentBranch(repoPath);

  return {
    identities,
    schedule,
    inPlace: cliArgs.inPlace ?? false,
    dryRun: cliArgs.dryRun ?? false,
    branch,
    repoPath,
    backup: cliArgs.backup ?? `refs/original/herodotus/${branch}`,
    seed: cliArgs.seed ?? Date.now(),
  };
}
