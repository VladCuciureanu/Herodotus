import { parse as parseToml } from "smol-toml";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HerodotusConfig, Identity, ScheduleConfig } from "./types.ts";
import { getDefaultIdentity, getCurrentBranch } from "./utils.ts";

function parseTime(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const DEFAULT_ALLOWED_DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat

export function parseAnchor(
  startDate?: string,
  endDate?: string,
): ScheduleConfig["anchor"] {
  if (startDate && endDate) {
    throw new Error("Cannot specify both --start-date and --end-date. Choose one.");
  }
  if (startDate) {
    const d = new Date(startDate);
    if (isNaN(d.getTime())) throw new Error(`Invalid start date: "${startDate}"`);
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
    if (n === undefined) throw new Error(`Invalid day: "${d}". Use Mon, Tue, etc.`);
    return n;
  });
}

interface TomlConfig {
  identity?: Array<{ name: string; email: string }>;
  schedule?: {
    start?: string;
    end?: string;
    timezone?: string;
    allowedDays?: string[];
    startDate?: string;
    endDate?: string;
  };
}

export async function loadConfigAsync(
  configPath: string | undefined,
  repoPath: string,
): Promise<Partial<HerodotusConfig>> {
  const filePath = resolve(repoPath, configPath ?? ".herodotus.toml");
  if (!existsSync(filePath)) return {};

  const content = await Deno.readTextFile(filePath);
  const toml = parseToml(content) as unknown as TomlConfig;

  const result: Partial<HerodotusConfig> = {};

  if (toml.identity && toml.identity.length > 0) {
    result.identities = toml.identity.map((i) => ({
      name: i.name,
      email: i.email,
    }));
  }

  if (toml.schedule) {
    result.schedule = {
      start: toml.schedule.start ? parseTime(toml.schedule.start) : 9 * 60,
      end: toml.schedule.end ? parseTime(toml.schedule.end) : 18 * 60,
      timezone: toml.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      allowedDays: toml.schedule.allowedDays ? parseDays(toml.schedule.allowedDays) : DEFAULT_ALLOWED_DAYS,
      anchor: parseAnchor(toml.schedule.startDate, toml.schedule.endDate),
    };
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
  cliArgs: Partial<HerodotusConfig>,
  fileConfig: Partial<HerodotusConfig>,
  repoPath: string,
): HerodotusConfig {
  const identities =
    cliArgs.identities ??
    fileConfig.identities ?? [getDefaultIdentity(repoPath)];

  const schedule: ScheduleConfig = {
    ...buildDefaultSchedule(),
    ...fileConfig.schedule,
    ...cliArgs.schedule,
  };

  const branch =
    cliArgs.branch ?? fileConfig.branch ?? getCurrentBranch(repoPath);

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
