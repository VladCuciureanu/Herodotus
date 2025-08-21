import { existsSync } from "fs";
import { resolve } from "path";

function getGitConfig(key: string, cwd: string): string | null {
  const result = Bun.spawnSync(["git", "config", key], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}

export async function runInit(repoPath: string): Promise<void> {
  const configPath = resolve(repoPath, ".herodotus.toml");

  if (existsSync(configPath)) {
    console.error("Error: .herodotus.toml already exists.");
    process.exit(1);
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

  await Bun.write(configPath, content);
  console.log(`Created .herodotus.toml`);
}
