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
 * Resolve the ref to rewrite to its full refname, refusing anything that
 * cannot be rewritten safely in either mode: revisions that are not refs
 * (a commit hash, HEAD~2, a detached HEAD), ambiguous names, and annotated
 * tags (rewriting one would replace the tag object, losing its message,
 * tagger and signature).
 */
export function resolveSourceRef(repoPath: string, branch: string): string {
  const result = spawnSync("git", ["rev-parse", "--symbolic-full-name", branch], {
    cwd: repoPath,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (/ambiguous/i.test(result.stderr)) {
    const refs = run(["git", "show-ref", "--", branch], repoPath)
      .split("\n")
      .map((line) => line.split(" ")[1])
      .filter(Boolean);
    throw new Error(
      `"${branch}" is ambiguous; it matches ${refs.join(", ")}. Pass the full refname instead (e.g. -b ${refs[0] ?? `refs/heads/${branch}`}).`,
    );
  }
  const source = result.status === 0 ? result.stdout.trim() : "";
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
  return source;
}

/**
 * Resolve the ref to rewrite (see resolveSourceRef) and pick the new local
 * branch it is written to, so the source ref is never overwritten whatever
 * its namespace (refs/heads, refs/remotes, refs/tags, ...).
 */
export function resolveRewriteTarget(repoPath: string, branch: string): RewriteTarget {
  const source = resolveSourceRef(repoPath, branch);
  // Strip the namespace by hand: `rev-parse --abbrev-ref` would keep a
  // "heads/" prefix for a name that also exists as a tag.
  const shortName = source.replace(/^refs\/(?:(?:heads|remotes|tags)\/)?/, "");
  return { source, target: `refs/heads/herodotus/${shortName}` };
}

/** Where an in-place rewrite of `branch` saves the ref's old value. */
export function defaultBackupRef(branch: string): string {
  return `refs/original/herodotus/${branch}`;
}

/**
 * Point a backup ref at exactly the object the ref holds (never peeled, so a
 * tag object would stay referenced) without ever overwriting an
 * existing backup: if `backupRef` is taken (e.g. by an earlier in-place run),
 * a timestamped `<backupRef>@<unix-ts>` is written instead. Returns the ref
 * that holds the backup.
 */
export function createBackupRef(repoPath: string, sourceRef: string, backupRef: string): string {
  const sha = run(["git", "rev-parse", "--verify", sourceRef], repoPath);
  const ts = Math.floor(Date.now() / 1000);
  const candidates = [backupRef, `${backupRef}@${ts}`];
  for (let n = 2; n <= 100; n++) candidates.push(`${backupRef}@${ts}-${n}`);
  for (const ref of candidates) {
    if (branchExists(repoPath, ref)) continue;
    // An empty old value makes update-ref fail if the ref appeared meanwhile.
    run(["git", "update-ref", ref, sha, ""], repoPath);
    return ref;
  }
  throw new Error(`Could not find a free backup ref name under ${backupRef}`);
}
