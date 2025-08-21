import type { Identity } from "./types.ts";

function run(cmd: string[], cwd: string): string {
  const result = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stderr: "piped",
    stdout: "piped",
  }).outputSync();
  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

export function getDefaultIdentity(repoPath: string): Identity {
  const name = run(["git", "config", "user.name"], repoPath);
  const email = run(["git", "config", "user.email"], repoPath);
  return { name, email };
}

export function getCurrentBranch(repoPath: string): string {
  return run(["git", "rev-parse", "--abbrev-ref", "HEAD"], repoPath);
}

export function isWorkingTreeClean(repoPath: string): boolean {
  const status = run(["git", "status", "--porcelain"], repoPath);
  return status === "";
}

export function branchExists(repoPath: string, branch: string): boolean {
  try {
    run(["git", "rev-parse", "--verify", branch], repoPath);
    return true;
  } catch {
    return false;
  }
}

export function createBackupRef(
  repoPath: string,
  branch: string,
  backupRef: string,
): void {
  const sha = run(["git", "rev-parse", branch], repoPath);
  run(["git", "update-ref", backupRef, sha], repoPath);
}
