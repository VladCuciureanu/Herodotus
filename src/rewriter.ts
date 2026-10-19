import { spawn, spawnSync } from "node:child_process";
import type { CommitInfo, HerodotusConfig, Identity } from "./types.ts";
import { stripAiCoAuthors } from "./ai-authors.ts";
import { capitalizeConventionalCommit } from "./commit-message.ts";
import { createIdentityPicker } from "./identity.ts";
import { redistributeTimestamps } from "./timeline.ts";

const LF = 0x0A; // '\n'
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseAuthorLine(
  line: string,
): { prefix: string; identity: Identity; timestamp: string } {
  const match = line.match(/^(author|committer)\s+(.+?)\s+<([^>]+)>\s+(.+)$/);
  if (!match) throw new Error(`Cannot parse author/committer line: ${line}`);
  return {
    prefix: match[1],
    identity: { name: match[2], email: match[3] },
    timestamp: match[4],
  };
}

function formatAuthorLine(
  prefix: string,
  identity: Identity,
  timestamp: string,
): string {
  return `${prefix} ${identity.name} <${identity.email}> ${timestamp}`;
}

function parseTimestamp(ts: string): number {
  return parseInt(ts.split(" ")[0]);
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
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ??
    "+00:00";

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
function readLine(
  buf: Uint8Array,
  offset: number,
): { line: string; next: number } {
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

interface CommitMeta {
  authorLine: string;
  committerLine: string;
  message: string;
  changeCount: number;
}

/**
 * Binary-safe fast-export stream processor.
 * Parses commits to extract metadata, but preserves all binary blob data untouched.
 * Returns the commit metadata and a function to produce the modified stream.
 */
function parseFastExportBinary(
  buf: Uint8Array,
): {
  commits: CommitMeta[];
  rebuild: (
    modifications: CommitModification[],
    refRename?: RefRename,
  ) => Uint8Array;
} {
  const commits: CommitMeta[] = [];
  // Track commit regions for later replacement
  const commitRegions: {
    headerStart: number;
    dataStart: number; // offset of "data N\n"
    dataContentStart: number; // offset of message content after "data N\n"
    dataLength: number; // N from "data N"
    bodyStart: number; // offset after message content
    bodyEnd: number; // end of commit block
    authorLine: string;
    committerLine: string;
    message: string;
    changeCount: number;
  }[] = [];
  // Track "reset <ref>" lines outside commits so the ref can be renamed
  const resetRegions: { start: number; end: number; line: string }[] = [];

  let offset = 0;
  while (offset < buf.length) {
    if (startsWith(buf, offset, "commit ")) {
      const headerStart = offset;
      let authorLine = "";
      let committerLine = "";

      // Read header lines until "data "
      while (offset < buf.length && !startsWith(buf, offset, "data ")) {
        const { line, next } = readLine(buf, offset);
        if (line.startsWith("author ")) authorLine = line;
        else if (line.startsWith("committer ")) committerLine = line;
        offset = next;
      }

      // Parse data section
      let message = "";
      let dataLength = 0;
      let dataStart = offset;
      let dataContentStart = offset;
      if (startsWith(buf, offset, "data ")) {
        const { line, next } = readLine(buf, offset);
        dataLength = parseInt(line.split(" ")[1]);
        dataStart = offset;
        dataContentStart = next;
        offset = next;

        // Read exactly dataLength bytes as the message (commit messages are text)
        const msgBytes = buf.subarray(offset, offset + dataLength);
        message = decoder.decode(msgBytes);
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

      const bodyEnd = offset;

      commitRegions.push({
        headerStart,
        dataStart,
        dataContentStart,
        dataLength,
        bodyStart,
        bodyEnd,
        authorLine,
        committerLine,
        message,
        changeCount,
      });

      commits.push({ authorLine, committerLine, message, changeCount });
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
        const blobSize = parseInt(line.split(" ")[1]);
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
        resetRegions.push({ start: offset, end: next, line });
      }
      offset = next;
    }
  }

  const rebuild = (
    modifications: CommitModification[],
    refRename?: RefRename,
  ): Uint8Array => {
    // Build modified output by replacing commit headers in-place.
    // Only command/header lines are decoded and re-encoded; everything else
    // (notably blob data) is copied byte-for-byte.
    const chunks: Uint8Array[] = [];
    let lastEnd = 0;
    let resetIdx = 0;

    const renameCommand = (line: string, command: string): string => {
      if (!refRename) return line;
      return line === `${command} ${refRename.from}`
        ? `${command} ${refRename.to}`
        : line;
    };

    // Copy buf[lastEnd, until) unchanged, except for renamed reset lines.
    const copyUntil = (until: number): void => {
      while (
        resetIdx < resetRegions.length &&
        resetRegions[resetIdx].start < until
      ) {
        const reset = resetRegions[resetIdx++];
        const renamed = renameCommand(reset.line, "reset");
        if (renamed === reset.line) continue;
        chunks.push(buf.subarray(lastEnd, reset.start));
        chunks.push(encoder.encode(renamed + "\n"));
        lastEnd = reset.end;
      }
      chunks.push(buf.subarray(lastEnd, until));
      lastEnd = until;
    };

    for (let i = 0; i < commitRegions.length; i++) {
      const region = commitRegions[i];
      const mod = modifications[i];

      // Copy everything before this commit's header unchanged
      copyUntil(region.headerStart);

      // Build new header
      const headerLines: string[] = [];
      let scanOffset = region.headerStart;
      while (scanOffset < region.dataStart) {
        const { line, next } = readLine(buf, scanOffset);
        if (line.startsWith("author ")) {
          headerLines.push(mod.authorLine);
        } else if (line.startsWith("committer ")) {
          headerLines.push(mod.committerLine);
        } else if (line.startsWith("commit ")) {
          headerLines.push(renameCommand(line, "commit"));
        } else {
          headerLines.push(line);
        }
        scanOffset = next;
      }

      // Write header
      chunks.push(encoder.encode(headerLines.join("\n") + "\n"));

      // Write new data section with modified message
      const msgBytes = encoder.encode(mod.message);
      chunks.push(encoder.encode(`data ${msgBytes.length}\n`));
      chunks.push(msgBytes);
      chunks.push(encoder.encode("\n"));

      // Copy body unchanged (file ops)
      chunks.push(buf.subarray(region.bodyStart, region.bodyEnd));

      lastEnd = region.bodyEnd;
    }

    // Copy remaining data after last commit
    copyUntil(buf.length);

    // Concatenate all chunks
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      result.set(c, pos);
      pos += c.length;
    }
    return result;
  };

  return { commits, rebuild };
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

/**
 * Run the full rewrite pipeline.
 */
export async function rewrite(config: HerodotusConfig): Promise<CommitInfo[]> {
  const { repoPath, branch, schedule, seed } = config;

  // Export (keep as raw bytes)
  const fullExportProc = spawnSync("git", ["fast-export", branch], {
    cwd: repoPath,
    maxBuffer: Infinity,
  });

  if (fullExportProc.error) throw fullExportProc.error;
  if (fullExportProc.status !== 0) {
    throw new Error(
      `git fast-export failed: ${decoder.decode(fullExportProc.stderr)}`,
    );
  }

  const rawExport: Uint8Array = fullExportProc.stdout;
  const { commits, rebuild } = parseFastExportBinary(rawExport);

  const originalTimestamps = commits.map((c) => {
    const parsed = parseAuthorLine(c.authorLine);
    return parseTimestamp(parsed.timestamp);
  });

  const changeCounts = commits.map((c) => c.changeCount);

  // Redistribute timestamps
  const newTimestamps = redistributeTimestamps(
    originalTimestamps,
    schedule,
    seed,
    changeCounts,
  );

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
    return changeLog;
  }

  // Determine target ref
  const targetRef = config.inPlace ? branch : `herodotus/${branch}`;

  // Rebuild the stream with modifications, pointing it at the target ref.
  // The rename is applied to parsed command lines only, so blob bytes are
  // never decoded/re-encoded (which would corrupt non-UTF-8 content).
  const modifiedStream = rebuild(
    modifications,
    targetRef !== branch
      ? { from: `refs/heads/${branch}`, to: `refs/heads/${targetRef}` }
      : undefined,
  );

  // Create backup if in-place
  if (config.inPlace && config.backup) {
    const { createBackupRef } = await import("./utils.ts");
    createBackupRef(repoPath, branch, config.backup as string);
  }

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

  return changeLog;
}
