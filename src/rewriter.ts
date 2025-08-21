import type { AlibiConfig, Identity, CommitInfo } from "./types";
import { stripAiCoAuthors } from "./ai-authors";
import { createIdentityPicker } from "./identity";
import { redistributeTimestamps } from "./timeline";

interface ParsedCommit {
  headerLines: string[]; // lines before the data section (commit, mark, author, committer, from, merge)
  authorLine: string;
  committerLine: string;
  message: string;
  dataLength: number;
  bodyLines: string[]; // lines after the data section (file ops, blank lines)
}

interface ParsedBlob {
  lines: string[];
}

type FastExportEntry = { type: "commit"; commit: ParsedCommit } | { type: "other"; lines: string[] };

function parseAuthorLine(line: string): { prefix: string; identity: Identity; timestamp: string } {
  // Format: "author Name <email> timestamp tz" or "committer Name <email> timestamp tz"
  const match = line.match(/^(author|committer)\s+(.+?)\s+<([^>]+)>\s+(.+)$/);
  if (!match) throw new Error(`Cannot parse author/committer line: ${line}`);
  return {
    prefix: match[1],
    identity: { name: match[2], email: match[3] },
    timestamp: match[4], // "epoch tz"
  };
}

function formatAuthorLine(prefix: string, identity: Identity, timestamp: string): string {
  return `${prefix} ${identity.name} <${identity.email}> ${timestamp}`;
}

function parseTimestamp(ts: string): number {
  // "1616000000 +0200" -> 1616000000
  return parseInt(ts.split(" ")[0]);
}

function formatTimestamp(epoch: number, tzOffset: string): string {
  return `${epoch} ${tzOffset}`;
}

/**
 * Compute timezone offset string for a given IANA timezone at a given epoch.
 */
function getTzOffset(epoch: number, tz: string): string {
  const date = new Date(epoch * 1000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "+00:00";

  // Convert "GMT+2" or "GMT-5:30" to "+0200" or "-0530"
  if (tzPart === "GMT") return "+0000";
  const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return "+0000";
  const sign = m[1];
  const hours = m[2].padStart(2, "0");
  const mins = (m[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}${mins}`;
}

/**
 * Parse the fast-export stream into entries.
 */
function parseFastExport(input: string): FastExportEntry[] {
  const lines = input.split("\n");
  const entries: FastExportEntry[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith("commit ")) {
      const commit = parseCommitBlock(lines, i);
      entries.push({ type: "commit", commit: commit.parsed });
      i = commit.nextIndex;
    } else {
      // Collect non-commit lines (blobs, resets, tags, etc.)
      const otherLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("commit ")) {
        otherLines.push(lines[i]);
        i++;
      }
      if (otherLines.length > 0) {
        entries.push({ type: "other", lines: otherLines });
      }
    }
  }

  return entries;
}

function parseCommitBlock(lines: string[], start: number): { parsed: ParsedCommit; nextIndex: number } {
  let i = start;
  const headerLines: string[] = [];
  let authorLine = "";
  let committerLine = "";

  // Read header lines until we hit "data"
  while (i < lines.length && !lines[i].startsWith("data ")) {
    if (lines[i].startsWith("author ")) {
      authorLine = lines[i];
    } else if (lines[i].startsWith("committer ")) {
      committerLine = lines[i];
    }
    headerLines.push(lines[i]);
    i++;
  }

  // Parse data section
  let message = "";
  let dataLength = 0;
  if (i < lines.length && lines[i].startsWith("data ")) {
    dataLength = parseInt(lines[i].split(" ")[1]);
    i++; // skip "data N" line

    // Read exactly dataLength bytes from subsequent lines
    let bytesRead = 0;
    const messageLines: string[] = [];
    while (i < lines.length && bytesRead < dataLength) {
      const line = lines[i];
      messageLines.push(line);
      bytesRead += Buffer.byteLength(line, "utf8") + 1; // +1 for newline
      i++;
    }
    message = messageLines.join("\n");
    // Trim to exact byte length if needed
    const messageBytes = Buffer.from(message, "utf8");
    if (messageBytes.length > dataLength) {
      message = Buffer.from(messageBytes.subarray(0, dataLength)).toString("utf8");
    }
  }

  // Read body lines (file operations, from, merge that come after data)
  const bodyLines: string[] = [];
  while (i < lines.length && lines[i] !== "" && !lines[i].startsWith("commit ") && !lines[i].startsWith("blob") && !lines[i].startsWith("reset ") && !lines[i].startsWith("tag ")) {
    bodyLines.push(lines[i]);
    i++;
  }

  // Include trailing blank line if present
  if (i < lines.length && lines[i] === "") {
    bodyLines.push(lines[i]);
    i++;
  }

  return {
    parsed: { headerLines, authorLine, committerLine, message, dataLength, bodyLines },
    nextIndex: i,
  };
}

function serializeCommit(commit: ParsedCommit): string {
  const lines: string[] = [];

  for (const line of commit.headerLines) {
    if (line.startsWith("author ")) {
      lines.push(commit.authorLine);
    } else if (line.startsWith("committer ")) {
      lines.push(commit.committerLine);
    } else {
      lines.push(line);
    }
  }

  const msgBytes = Buffer.byteLength(commit.message, "utf8");
  lines.push(`data ${msgBytes}`);
  lines.push(commit.message);

  for (const line of commit.bodyLines) {
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Run the full rewrite pipeline.
 */
export async function rewrite(config: AlibiConfig): Promise<CommitInfo[]> {
  const { repoPath, branch, schedule, seed } = config;

  // Export
  const exportProc = Bun.spawnSync(
    ["git", "fast-export", "--no-data", branch],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
  );

  // --no-data won't work for import, we need full data. Let's use full export.
  const fullExportProc = Bun.spawnSync(
    ["git", "fast-export", branch],
    { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
  );

  if (fullExportProc.exitCode !== 0) {
    throw new Error(`git fast-export failed: ${fullExportProc.stderr.toString()}`);
  }

  const exportData = fullExportProc.stdout.toString();
  const entries = parseFastExport(exportData);

  // Collect commit timestamps for redistribution
  const commits = entries.filter((e) => e.type === "commit") as Array<{ type: "commit"; commit: ParsedCommit }>;

  const originalTimestamps = commits.map((e) => {
    const parsed = parseAuthorLine(e.commit.authorLine);
    return parseTimestamp(parsed.timestamp);
  });

  // Redistribute timestamps
  const newTimestamps = redistributeTimestamps(originalTimestamps, schedule, seed);

  // Create identity picker
  const pickIdentity = createIdentityPicker(config.identities, seed);

  // Build change log for dry-run
  const changeLog: CommitInfo[] = [];

  // Apply transformations
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i].commit;
    const origAuthor = parseAuthorLine(commit.authorLine);
    const origCommitter = parseAuthorLine(commit.committerLine);
    const newIdentity = pickIdentity(i);
    const tzOffset = getTzOffset(newTimestamps[i], schedule.timezone);
    const newTs = formatTimestamp(newTimestamps[i], tzOffset);

    // Replace author/committer
    commit.authorLine = formatAuthorLine("author", newIdentity, newTs);
    commit.committerLine = formatAuthorLine("committer", newIdentity, newTs);

    // Strip AI co-authors from message
    commit.message = stripAiCoAuthors(commit.message);

    changeLog.push({
      index: i,
      originalAuthor: origAuthor.identity,
      originalCommitter: origCommitter.identity,
      authorDate: origAuthor.timestamp,
      commitDate: origCommitter.timestamp,
      message: commit.message.split("\n")[0], // first line only for display
      newAuthor: newIdentity,
      newCommitter: newIdentity,
      newAuthorDate: newTs,
      newCommitDate: newTs,
    });
  }

  if (config.dryRun) {
    return changeLog;
  }

  // Serialize back
  const output = entries.map((e) => {
    if (e.type === "commit") return serializeCommit(e.commit);
    return e.lines.join("\n");
  }).join("\n");

  // Determine target ref
  const targetRef = config.inPlace ? branch : `alibi/${branch}`;

  // Create backup if in-place
  if (config.inPlace && config.backup) {
    const { createBackupRef } = await import("./utils");
    createBackupRef(repoPath, branch, config.backup as string);
  }

  // Import
  const importProc = Bun.spawn(
    ["git", "fast-import", "--force", "--quiet"],
    { cwd: repoPath, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );

  // Write the modified stream, replacing the branch ref
  const modifiedOutput = output.replace(
    new RegExp(`^commit refs/heads/${escapeRegex(branch)}`, "gm"),
    `commit refs/heads/${targetRef}`,
  );

  importProc.stdin.write(modifiedOutput);
  importProc.stdin.end();

  const exitCode = await importProc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(importProc.stderr).text();
    throw new Error(`git fast-import failed: ${stderr}`);
  }

  return changeLog;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
