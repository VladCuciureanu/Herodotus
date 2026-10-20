import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function getGitConfig(key: string, cwd: string): string | null {
  const result = spawnSync("git", ["config", key], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

export async function runInit(repoPath: string): Promise<void> {
  const configPath = resolve(repoPath, ".herodotus.toml");

  if (existsSync(configPath)) {
    throw new Error(".herodotus.toml already exists.");
  }

  const name = getGitConfig("user.name", repoPath) ?? "Your Name";
  const email = getGitConfig("user.email", repoPath) ?? "you@example.com";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const content = `[[identity]]
name = "${name}"
email = "${email}"

[schedule]
# start = "09:00"
# end = "18:00"
# timezone = "${tz}"
# allowedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
# startDate = "2026-01-01T09:00:00"
# endDate = "2026-12-31T18:00:00"
`;

  await writeFile(configPath, content);
  console.log(`Created .herodotus.toml`);
}
