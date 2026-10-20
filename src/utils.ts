import { spawnSync } from "node:child_process";
import type { Identity } from "./types.ts";

function run(cmd: string[], cwd: string): string {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: Infinity,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr}`);
  }
  return result.stdout.trim();
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

/** Where default (non in-place) mode reads from and writes to. */
export interface RewriteTarget {
  source: string; // full refname being rewritten, e.g. "refs/remotes/origin/main"
  target: string; // new local branch, e.g. "refs/heads/herodotus/origin/main"
}

/**
 * Resolve the ref to rewrite to its full refname and pick the new local
 * branch it is written to, so the source ref is never overwritten whatever
 * its namespace (refs/heads, refs/remotes, refs/tags, ...).
 */
export function resolveRewriteTarget(
  repoPath: string,
  branch: string,
): RewriteTarget {
  let source = "";
  try {
    source = run(["git", "rev-parse", "--symbolic-full-name", branch], repoPath);
  } catch {
    // fall through to the error below
  }
  if (!source.startsWith("refs/")) {
    throw new Error(
      `"${branch}" does not name a branch or other ref. Create a branch from it first (git branch <name> ${branch}).`,
    );
  }
  if (
    source.startsWith("refs/tags/") &&
    run(["git", "cat-file", "-t", source], repoPath) === "tag"
  ) {
    throw new Error(
      `"${branch}" is an annotated tag, which cannot be rewritten without replacing it. Create a branch from it first (git branch <name> ${branch}).`,
    );
  }
  const shortName = run(["git", "rev-parse", "--abbrev-ref", source], repoPath);
  return { source, target: `refs/heads/herodotus/${shortName}` };
}

export function createBackupRef(
  repoPath: string,
  branch: string,
  backupRef: string,
): void {
  const sha = run(["git", "rev-parse", branch], repoPath);
  run(["git", "update-ref", backupRef, sha], repoPath);
}
