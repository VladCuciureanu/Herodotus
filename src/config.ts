import { parse as parseToml } from "smol-toml";
import { existsSync } from "fs";
import { resolve } from "path";
import type { HerodotusConfig, Identity, ScheduleConfig } from "./types";
import { getDefaultIdentity, getCurrentBranch } from "./utils";

function parseTime(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

interface TomlConfig {
  identity?: Array<{ name: string; email: string }>;
  schedule?: {
    start?: string;
    end?: string;
    timezone?: string;
    weekends?: boolean;
  };
}

export function loadConfig(
  configPath: string | undefined,
  repoPath: string,
): Partial<HerodotusConfig> {
  const filePath = resolve(repoPath, configPath ?? ".herodotus.toml");
  if (!existsSync(filePath)) return {};

  const raw = Bun.file(filePath).text();
  // smol-toml parse is sync when given a string but the Bun.file().text() is async
  // We'll handle this in the async main function instead
  return { _configPath: filePath } as any;
}

export async function loadConfigAsync(
  configPath: string | undefined,
  repoPath: string,
): Promise<Partial<HerodotusConfig>> {
  const filePath = resolve(repoPath, configPath ?? ".herodotus.toml");
  if (!existsSync(filePath)) return {};

  const content = await Bun.file(filePath).text();
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
      weekends: toml.schedule.weekends ?? false,
    };
  }

  return result;
}

export function buildDefaultSchedule(): ScheduleConfig {
  return {
    start: 9 * 60,
    end: 18 * 60,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekends: false,
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
