import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stringify } from "smol-toml";
import { run } from "./utils.ts";

function getGitConfig(key: string, cwd: string): string | null {
  try {
    return run(["git", "config", key], cwd);
  } catch {
    return null;
  }
}

/** Write a starter config to `configPath` (relative to the repo), never overwriting. */
export async function runInit(repoPath: string, configPath = ".herodotus.toml"): Promise<void> {
  const filePath = resolve(repoPath, configPath);

  if (existsSync(filePath)) {
    throw new Error(`${configPath} already exists.`);
  }

  const name = getGitConfig("user.name", repoPath) ?? "Your Name";
  const email = getGitConfig("user.email", repoPath) ?? "you@example.com";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // stringify escapes quotes and backslashes in the git name and email.
  const content = `${stringify({ identity: [{ name, email }] })}
[schedule]
# start = "09:00"
# end = "18:00"
# timezone = "${tz}"
# allowedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
# startDate = "2026-01-01T09:00:00"
# endDate = "2026-12-31T18:00:00"
`;

  await writeFile(filePath, content);
  console.log(`Created ${configPath}`);
}
