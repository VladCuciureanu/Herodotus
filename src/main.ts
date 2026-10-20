#!/usr/bin/env node
import process from "node:process";
import { parseCli, parseInitCli, printUsage, UsageError } from "./cli.ts";
import { formatTime } from "./config.ts";
import { runInit } from "./init.ts";
import { rewrite } from "./rewriter.ts";
import {
  branchExists,
  defaultBackupRef,
  isWorkingTreeClean,
  resolveRewriteTarget,
} from "./utils.ts";

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "init") {
    const options = parseInitCli(args.slice(1));
    if (!options) printUsage();
    else await runInit(options.repoPath, options.configPath);
    return;
  }

  const config = await parseCli(args);
  if (!config) {
    printUsage();
    return;
  }

  // Safety checks
  if (!config.dryRun && !isWorkingTreeClean(config.repoPath)) {
    throw new Error("working tree has uncommitted changes. Commit or stash them first.");
  }

  if (!branchExists(config.repoPath, config.branch)) {
    throw new Error(`ref "${config.branch}" does not exist.`);
  }

  // Refuses non-refs, ambiguous names and annotated tags in both modes.
  // Default mode writes to a new local branch and never touches the source ref.
  const refs = resolveRewriteTarget(config.repoPath, config.branch);
  const { target } = refs;
  const targetName = target.replace(/^refs\/heads\//, "");
  if (!config.inPlace && branchExists(config.repoPath, target)) {
    throw new Error(`branch "${targetName}" already exists. Delete it first or use --in-place.`);
  }

  console.log(`Herodotus: rewriting ${config.branch}${config.dryRun ? " (dry run)" : ""}`);
  console.log(`  Identities: ${config.identities.map((i) => `${i.name} <${i.email}>`).join(", ")}`);
  const { start, end, timezone } = config.schedule;
  console.log(`  Schedule: ${formatTime(start)} – ${formatTime(end)} ${timezone}`);
  console.log(`  Mode: ${config.inPlace ? "in-place" : `new branch ${targetName}`}`);
  console.log();

  const { changes, backupRef } = await rewrite(config, { refs });

  if (config.dryRun) {
    console.log("Changes that would be applied:\n");
    for (const c of changes) {
      const origDate = new Date(parseInt(c.authorDate.split(" ")[0], 10) * 1000).toISOString();
      const newDate = new Date(parseInt(c.newAuthorDate.split(" ")[0], 10) * 1000).toISOString();
      console.log(`  #${c.index + 1}: "${c.message}"`);
      console.log(
        `    Author:  ${c.originalAuthor.name} <${c.originalAuthor.email}> → ${
          c.newAuthor.name
        } <${c.newAuthor.email}>`,
      );
      console.log(`    Date:    ${origDate} → ${newDate}`);
      console.log();
    }
  } else {
    console.log(`Rewrote ${changes.length} commit(s).`);
    if (backupRef) {
      console.log(`Backup of the original ${config.branch} stored at: ${backupRef}`);
      const defaultRef = defaultBackupRef(config.branch);
      if (backupRef !== defaultRef) {
        console.log(`  (${defaultRef} already held an earlier backup and was left unchanged)`);
      }
    }
  }
}

/** One line on stderr, without a stack trace; git's multi-line output is joined. */
function formatError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = message.trim().replace(/\s*\n\s*/g, " ");
  const isUsageError =
    err instanceof UsageError ||
    (err instanceof Error && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"));
  return `herodotus: ${line}${isUsageError ? " See herodotus --help." : ""}`;
}

main().catch((err) => {
  console.error(formatError(err));
  process.exitCode = 1;
});
