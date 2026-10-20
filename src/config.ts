import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";
import type { HerodotusConfig, Identity, ScheduleConfig } from "./types.ts";
import { getCurrentBranch, getDefaultIdentity } from "./utils.ts";

export function parseTime(s: string): number {
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time format: "${s}". Expected "HH:MM"`);
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h > 23 || m > 59) {
    throw new Error(`Invalid time: "${s}". Hours must be 0-23, minutes 0-59`);
  }
  return h * 60 + m;
}

/** Minutes from midnight as "H:MM", the inverse of parseTime. */
export function formatTime(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export const DAY_MAP: Record<string, number> = {
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
  startDate?: string | Date,
  endDate?: string | Date,
): ScheduleConfig["anchor"] {
  if (startDate && endDate) {
    throw new Error("Cannot specify both --start-date and --end-date. Choose one.");
  }
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid start date: "${startDate}"`);
    }
    return { type: "start", date: d };
  }
  if (endDate) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid end date: "${endDate}"`);
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
  startDate?: string | Date;
  endDate?: string | Date;
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

/** What a config file can set. */
export interface FileConfig {
  identities?: Identity[];
  schedule?: Partial<ScheduleConfig>;
}

type Table = Record<string, unknown>;

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(table: Table, allowed: readonly string[], prefix: string): void {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) {
      throw new Error(`unknown key "${prefix}${key}"; expected one of ${allowed.join(", ")}`);
    }
  }
}

function optionalString(table: Table, key: string, prefix: string): string | undefined {
  const value = table[key];
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`"${prefix}${key}" must be a string`);
  }
  return value;
}

function parseTomlIdentity(entry: unknown, n: number): Identity {
  const prefix = `identity[${n}].`;
  if (!isTable(entry)) throw new Error(`each [[identity]] must be a table with name and email`);
  checkKeys(entry, ["name", "email"], prefix);
  const name = optionalString(entry, "name", prefix);
  const email = optionalString(entry, "email", prefix);
  if (!name?.trim() || !email?.trim())
    throw new Error(`[[identity]] #${n + 1} needs a non-empty name and email`);
  return { name, email };
}

const SCHEDULE_KEYS = ["start", "end", "timezone", "allowedDays", "startDate", "endDate"];

function parseTomlSchedule(schedule: unknown): ScheduleInput {
  if (!isTable(schedule)) throw new Error(`"schedule" must be a table`);
  checkKeys(schedule, SCHEDULE_KEYS, "schedule.");
  const { allowedDays, startDate, endDate } = schedule;
  if (
    allowedDays !== undefined &&
    !(Array.isArray(allowedDays) && allowedDays.every((d) => typeof d === "string"))
  ) {
    throw new Error(`"schedule.allowedDays" must be an array of strings`);
  }
  // TOML date-times (unquoted) parse to Dates, which new Date() accepts too.
  for (const [key, value] of Object.entries({ startDate, endDate })) {
    if (value !== undefined && typeof value !== "string" && !(value instanceof Date)) {
      throw new Error(`"schedule.${key}" must be a date string`);
    }
  }
  return {
    start: optionalString(schedule, "start", "schedule."),
    end: optionalString(schedule, "end", "schedule."),
    timezone: optionalString(schedule, "timezone", "schedule."),
    allowedDays,
    startDate: startDate as ScheduleInput["startDate"],
    endDate: endDate as ScheduleInput["endDate"],
  };
}

/** Validate a parsed config file; throws on unknown keys and malformed values. */
function parseConfigFile(toml: Table): FileConfig {
  checkKeys(toml, ["identity", "schedule"], "");
  const result: FileConfig = {};

  if (toml.identity !== undefined) {
    if (!Array.isArray(toml.identity)) {
      throw new Error(`"identity" must be written as [[identity]] tables`);
    }
    if (toml.identity.length > 0) result.identities = toml.identity.map(parseTomlIdentity);
  }

  if (toml.schedule !== undefined) {
    result.schedule = parseSchedule(parseTomlSchedule(toml.schedule));
  }

  return result;
}

export async function loadConfigAsync(
  configPath: string | undefined,
  repoPath: string,
): Promise<FileConfig> {
  const filePath = resolve(repoPath, configPath ?? ".herodotus.toml");
  if (!existsSync(filePath)) {
    // Only the default file is optional; a file named with -c must exist.
    if (configPath !== undefined) throw new Error(`Config file not found: ${filePath}`);
    return {};
  }

  const content = await readFile(filePath, "utf8");
  try {
    return parseConfigFile(parseToml(content));
  } catch (err) {
    if (err instanceof TomlError) {
      const reason = err.message.split("\n")[0];
      throw new Error(`${filePath}:${err.line}:${err.column}: ${reason}`);
    }
    throw new Error(`${filePath}: ${(err as Error).message}`);
  }
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
  fileConfig: FileConfig,
  repoPath: string,
): HerodotusConfig {
  const identities = cliArgs.identities ?? fileConfig.identities ?? [getDefaultIdentity(repoPath)];

  // Each source only carries the fields it set, so later sources override
  // earlier ones field by field.
  const schedule: ScheduleConfig = {
    ...buildDefaultSchedule(),
    ...fileConfig.schedule,
    ...cliArgs.schedule,
  };
  if (schedule.start >= schedule.end) {
    throw new Error(
      `Workday start (${formatTime(schedule.start)}) must be before its end (${formatTime(schedule.end)})`,
    );
  }
  if (schedule.allowedDays.length === 0) {
    throw new Error("allowedDays must name at least one day");
  }

  const branch = cliArgs.branch ?? getCurrentBranch(repoPath);

  return {
    identities,
    schedule,
    inPlace: cliArgs.inPlace ?? false,
    dryRun: cliArgs.dryRun ?? false,
    branch,
    repoPath,
    seed: cliArgs.seed ?? Date.now(),
  };
}
