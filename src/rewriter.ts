import { spawn, spawnSync } from "node:child_process";
import { stripAiCoAuthors } from "./ai-authors.ts";
import { capitalizeConventionalCommit } from "./commit-message.ts";
import { createIdentityPicker } from "./identity.ts";
import { redistributeTimestamps } from "./timeline.ts";
import type { CommitInfo, HerodotusConfig, Identity } from "./types.ts";
import { createBackupRef, defaultBackupRef, resolveRewriteTarget } from "./utils.ts";

const LF = 0x0a; // '\n'
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseAuthorLine(line: string): { prefix: string; identity: Identity; timestamp: string } {
  const match = line.match(/^(author|committer)\s+(.+?)\s+<([^>]+)>\s+(.+)$/);
  if (!match) throw new Error(`Cannot parse author/committer line: ${line}`);
  return {
    prefix: match[1],
    identity: { name: match[2], email: match[3] },
    timestamp: match[4],
  };
}

function formatAuthorLine(prefix: string, identity: Identity, timestamp: string): string {
  return `${prefix} ${identity.name} <${identity.email}> ${timestamp}`;
}

function parseTimestamp(ts: string): number {
  return parseInt(ts.split(" ")[0], 10);
}

function formatTimestamp(epoch: number, tzOffset: string): string {
  return `${epoch} ${tzOffset}`;
}

function getTzOffset(epoch: number, tz: string): string {
  const date = new Date(epoch * 1000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "+00:00";

  if (tzPart === "GMT") return "+0000";
  const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return "+0000";
  const sign = m[1];
  const hours = m[2].padStart(2, "0");
  const mins = (m[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}${mins}`;
}

/**
 * Find next LF in a Uint8Array starting from offset. Returns -1 if not found.
 */
function findLF(buf: Uint8Array, start: number): number {
  for (let i = start; i < buf.length; i++) {
    if (buf[i] === LF) return i;
  }
  return -1;
}

/**
 * Read one line from buf starting at offset. Returns the line (without LF) and the next offset.
 */
function readLine(buf: Uint8Array, offset: number): { line: string; next: number } {
  const lfPos = findLF(buf, offset);
  if (lfPos === -1) {
    return { line: decoder.decode(buf.subarray(offset)), next: buf.length };
  }
  return {
    line: decoder.decode(buf.subarray(offset, lfPos)),
    next: lfPos + 1,
  };
}

/**
 * Check if buf at offset starts with the given ASCII prefix.
 */
function startsWith(buf: Uint8Array, offset: number, prefix: string): boolean {
  const prefixBytes = encoder.encode(prefix);
  if (offset + prefixBytes.length > buf.length) return false;
  for (let i = 0; i < prefixBytes.length; i++) {
    if (buf[offset + i] !== prefixBytes[i]) return false;
  }
  return true;
}

/** A commit in the fast-export stream and the byte ranges it occupies. */
interface CommitRegion {
  headerStart: number; // offset of "commit <ref>"
  headerLines: string[]; // lines between "commit" and "data N" (inclusive of "commit")
  bodyStart: number; // offset after the message content
  bodyEnd: number; // end of the commit block
  authorLine: string;
  committerLine: string;
  message: string;
  changeCount: number;
}

/** A "reset <ref>" line outside commits, kept so the ref can be renamed. */
interface ResetRegion {
  start: number;
  end: number;
  line: string;
}

interface ParsedExport {
  buf: Uint8Array;
  commits: CommitRegion[];
  resets: ResetRegion[];
}

/**
 * Binary-safe fast-export stream parser.
 * Parses commit headers and messages, but only records the byte offsets of
 * everything else so blob data is never decoded.
 */
function parseFastExportBinary(buf: Uint8Array): ParsedExport {
  const commits: CommitRegion[] = [];
  const resets: ResetRegion[] = [];

  let offset = 0;
  while (offset < buf.length) {
    if (startsWith(buf, offset, "commit ")) {
      const headerStart = offset;
      const headerLines: string[] = [];
      let authorLine = "";
      let committerLine = "";

      // Read header lines until "data "
      while (offset < buf.length && !startsWith(buf, offset, "data ")) {
        const { line, next } = readLine(buf, offset);
        if (line.startsWith("author ")) authorLine = line;
        else if (line.startsWith("committer ")) committerLine = line;
        headerLines.push(line);
        offset = next;
      }

      // Parse data section
      let message = "";
      if (startsWith(buf, offset, "data ")) {
        const { line, next } = readLine(buf, offset);
        const dataLength = parseInt(line.split(" ")[1], 10);
        offset = next;

        // Read exactly dataLength bytes as the message (commit messages are text)
        message = decoder.decode(buf.subarray(offset, offset + dataLength));
        offset += dataLength;

        // Skip the LF after the data content if present
        if (offset < buf.length && buf[offset] === LF) {
          offset++;
        }
      }

      const bodyStart = offset;

      // Count file changes (M, D, R, C lines) and skip body
      let changeCount = 0;
      while (offset < buf.length) {
        // Check for end of commit block
        if (buf[offset] === LF) {
          offset++;
          break;
        }
        if (
          startsWith(buf, offset, "commit ") ||
          startsWith(buf, offset, "blob") ||
          startsWith(buf, offset, "reset ") ||
          startsWith(buf, offset, "tag ")
        ) {
          break;
        }
        const { line, next } = readLine(buf, offset);
        if (/^[MDRC] /.test(line)) changeCount++;
        offset = next;
      }

      commits.push({
        headerStart,
        headerLines,
        bodyStart,
        bodyEnd: offset,
        authorLine,
        committerLine,
        message,
        changeCount,
      });
    } else if (startsWith(buf, offset, "blob")) {
      // Skip blob: read past header and data section (binary-safe)
      const { next: afterBlob } = readLine(buf, offset);
      offset = afterBlob;

      // Read mark line if present
      if (startsWith(buf, offset, "mark ")) {
        const { next } = readLine(buf, offset);
        offset = next;
      }

      // Read data section
      if (startsWith(buf, offset, "data ")) {
        const { line, next } = readLine(buf, offset);
        const blobSize = parseInt(line.split(" ")[1], 10);
        offset = next + blobSize;
        // Skip trailing LF
        if (offset < buf.length && buf[offset] === LF) {
          offset++;
        }
      }
    } else {
      // Other lines (reset, tag, etc.) - skip line by line
      const { line, next } = readLine(buf, offset);
      if (line.startsWith("reset ")) {
        resets.push({ start: offset, end: next, line });
      }
      offset = next;
    }
  }

  return { buf, commits, resets };
}

/**
 * Produce the modified stream: commit headers and messages are replaced, and
 * the ref in "commit"/"reset" lines is optionally renamed. Everything else
 * (notably blob data) is copied byte-for-byte.
 */
function rebuildFastExport(
  { buf, commits, resets }: ParsedExport,
  modifications: CommitModification[],
  refRename?: RefRename,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let lastEnd = 0;
  let resetIdx = 0;

  const renameCommand = (line: string, command: string): string => {
    if (!refRename) return line;
    return line === `${command} ${refRename.from}` ? `${command} ${refRename.to}` : line;
  };

  // Copy buf[lastEnd, until) unchanged, except for renamed reset lines.
  const copyUntil = (until: number): void => {
    while (resetIdx < resets.length && resets[resetIdx].start < until) {
      const reset = resets[resetIdx++];
      const renamed = renameCommand(reset.line, "reset");
      if (renamed === reset.line) continue;
      chunks.push(buf.subarray(lastEnd, reset.start));
      chunks.push(encoder.encode(`${renamed}\n`));
      lastEnd = reset.end;
    }
    chunks.push(buf.subarray(lastEnd, until));
    lastEnd = until;
  };

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const mod = modifications[i];

    // Copy everything before this commit's header unchanged
    copyUntil(commit.headerStart);

    const headerLines = commit.headerLines.map((line) => {
      if (line.startsWith("author ")) return mod.authorLine;
      if (line.startsWith("committer ")) return mod.committerLine;
      if (line.startsWith("commit ")) return renameCommand(line, "commit");
      return line;
    });
    chunks.push(encoder.encode(`${headerLines.join("\n")}\n`));

    // Write new data section with modified message
    const msgBytes = encoder.encode(mod.message);
    chunks.push(encoder.encode(`data ${msgBytes.length}\n`));
    chunks.push(msgBytes);
    chunks.push(encoder.encode("\n"));

    // Copy body unchanged (file ops)
    chunks.push(buf.subarray(commit.bodyStart, commit.bodyEnd));
    lastEnd = commit.bodyEnd;
  }

  // Copy remaining data after last commit
  copyUntil(buf.length);

  return Buffer.concat(chunks);
}

interface RefRename {
  from: string; // full ref name, e.g. "refs/heads/main"
  to: string;
}

interface CommitModification {
  authorLine: string;
  committerLine: string;
  message: string;
}

export interface RewriteResult {
  changes: CommitInfo[];
  /** Ref holding the pre-rewrite commit, when an in-place backup was made. */
  backupRef?: string;
}

/**
 * Run the full rewrite pipeline.
 */
export async function rewrite(config: HerodotusConfig): Promise<RewriteResult> {
  const { repoPath, branch, schedule, seed } = config;

  // Both modes need a real, unambiguous ref that is safe to rewrite; this
  // refuses commit hashes, detached HEAD, ambiguous names and annotated tags.
  // Default mode writes to herodotus/<name>; in-place rewrites `source` itself.
  const { source, target } = resolveRewriteTarget(repoPath, branch);

  // Export (keep as raw bytes). --reencode=yes converts commit messages with a
  // non-UTF-8 "encoding" header to UTF-8 (fast-export aborts on them by
  // default); blob contents are never re-encoded.
  const fullExportProc = spawnSync("git", ["fast-export", "--reencode=yes", source], {
    cwd: repoPath,
    maxBuffer: Infinity,
  });

  if (fullExportProc.error) throw fullExportProc.error;
  if (fullExportProc.status !== 0) {
    throw new Error(`git fast-export failed: ${decoder.decode(fullExportProc.stderr)}`);
  }

  const rawExport: Uint8Array = fullExportProc.stdout;
  const parsedExport = parseFastExportBinary(rawExport);
  const { commits } = parsedExport;

  const originalTimestamps = commits.map((c) => {
    const parsed = parseAuthorLine(c.authorLine);
    return parseTimestamp(parsed.timestamp);
  });

  const changeCounts = commits.map((c) => c.changeCount);

  // Redistribute timestamps
  const newTimestamps = redistributeTimestamps(originalTimestamps, schedule, seed, changeCounts);

  // Create identity picker
  const pickIdentity = createIdentityPicker(config.identities, seed);

  // Build change log and modifications
  const changeLog: CommitInfo[] = [];
  const modifications: CommitModification[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const origAuthor = parseAuthorLine(commit.authorLine);
    const origCommitter = parseAuthorLine(commit.committerLine);
    const newIdentity = pickIdentity(i);
    const tzOffset = getTzOffset(newTimestamps[i], schedule.timezone);
    const newTs = formatTimestamp(newTimestamps[i], tzOffset);

    // Transform message
    let message = stripAiCoAuthors(commit.message);
    message = capitalizeConventionalCommit(message);

    const newAuthorLine = formatAuthorLine("author", newIdentity, newTs);
    const newCommitterLine = formatAuthorLine("committer", newIdentity, newTs);

    modifications.push({
      authorLine: newAuthorLine,
      committerLine: newCommitterLine,
      message,
    });

    changeLog.push({
      index: i,
      originalAuthor: origAuthor.identity,
      originalCommitter: origCommitter.identity,
      authorDate: origAuthor.timestamp,
      commitDate: origCommitter.timestamp,
      message: message.split("\n")[0],
      newAuthor: newIdentity,
      newCommitter: newIdentity,
      newAuthorDate: newTs,
      newCommitDate: newTs,
    });
  }

  if (config.dryRun) {
    return { changes: changeLog };
  }

  // Outside in-place mode, point the stream at the new local branch. fast-export
  // names the ref by its full refname, so resolve it the same way; this renames
  // remote-tracking refs and tags too, and never overwrites the source ref.
  // The rename is applied to parsed command lines only, so blob bytes are
  // never decoded/re-encoded (which would corrupt non-UTF-8 content).
  const modifiedStream = rebuildFastExport(
    parsedExport,
    modifications,
    config.inPlace ? undefined : { from: source, to: target },
  );

  // Always back up before rewriting in place. An existing backup is never
  // overwritten.
  const backupRef = config.inPlace
    ? createBackupRef(repoPath, source, defaultBackupRef(branch))
    : undefined;

  // Import using raw bytes
  const importProc = spawn("git", ["fast-import", "--force", "--quiet"], {
    cwd: repoPath,
    stdio: ["pipe", "ignore", "pipe"],
  });

  const stderrChunks: Buffer[] = [];
  importProc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  // A write error (e.g. EPIPE if git exits early) surfaces via the exit code.
  importProc.stdin.on("error", () => {});
  importProc.stdin.end(modifiedStream);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    importProc.on("error", reject);
    importProc.on("close", resolve);
  });
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    throw new Error(`git fast-import failed: ${stderr}`);
  }

  return { changes: changeLog, backupRef };
}
