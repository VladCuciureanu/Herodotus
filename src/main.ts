#!/usr/bin/env bun
import { parseCli } from "./cli";
import { rewrite } from "./rewriter";
import { isWorkingTreeClean, branchExists } from "./utils";

async function main() {
  const config = await parseCli(process.argv.slice(2));

  // Safety checks
  if (!config.dryRun && !isWorkingTreeClean(config.repoPath)) {
    console.error("Error: working tree has uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }

  if (!branchExists(config.repoPath, config.branch)) {
    console.error(`Error: branch "${config.branch}" does not exist.`);
    process.exit(1);
  }

  if (!config.inPlace && branchExists(config.repoPath, `alibi/${config.branch}`)) {
    console.error(`Error: branch "alibi/${config.branch}" already exists. Delete it first or use --in-place.`);
    process.exit(1);
  }

  console.log(`Alibi: rewriting ${config.branch}${config.dryRun ? " (dry run)" : ""}`);
  console.log(`  Identities: ${config.identities.map((i) => `${i.name} <${i.email}>`).join(", ")}`);
  console.log(`  Schedule: ${Math.floor(config.schedule.start / 60)}:${String(config.schedule.start % 60).padStart(2, "0")} – ${Math.floor(config.schedule.end / 60)}:${String(config.schedule.end % 60).padStart(2, "0")} ${config.schedule.timezone}`);
  console.log(`  Mode: ${config.inPlace ? "in-place" : `new branch alibi/${config.branch}`}`);
  console.log();

  const changes = await rewrite(config);

  if (config.dryRun) {
    console.log("Changes that would be applied:\n");
    for (const c of changes) {
      const origDate = new Date(parseInt(c.authorDate.split(" ")[0]) * 1000).toISOString();
      const newDate = new Date(parseInt(c.newAuthorDate!.split(" ")[0]) * 1000).toISOString();
      console.log(`  #${c.index + 1}: "${c.message}"`);
      console.log(`    Author:  ${c.originalAuthor.name} <${c.originalAuthor.email}> → ${c.newAuthor!.name} <${c.newAuthor!.email}>`);
      console.log(`    Date:    ${origDate} → ${newDate}`);
      console.log();
    }
  } else {
    console.log(`Rewrote ${changes.length} commit(s).`);
    if (config.inPlace && config.backup) {
      console.log(`Backup stored at: ${config.backup}`);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
