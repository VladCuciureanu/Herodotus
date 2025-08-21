#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
import { parseCli } from "./cli.ts";
import { runInit } from "./init.ts";
import { rewrite } from "./rewriter.ts";
import { branchExists, isWorkingTreeClean } from "./utils.ts";
import { resolve } from "node:path";

async function main() {
  const args = Deno.args;

  if (args[0] === "init") {
    const repoPath = resolve(args[1] ?? ".");
    await runInit(repoPath);
    return;
  }

  const config = await parseCli(args);

  // Safety checks
  if (!config.dryRun && !isWorkingTreeClean(config.repoPath)) {
    console.error(
      "Error: working tree has uncommitted changes. Commit or stash them first.",
    );
    Deno.exit(1);
  }

  if (!branchExists(config.repoPath, config.branch)) {
    console.error(`Error: branch "${config.branch}" does not exist.`);
    Deno.exit(1);
  }

  if (
    !config.inPlace &&
    branchExists(config.repoPath, `herodotus/${config.branch}`)
  ) {
    console.error(
      `Error: branch "herodotus/${config.branch}" already exists. Delete it first or use --in-place.`,
    );
    Deno.exit(1);
  }

  console.log(
    `Herodotus: rewriting ${config.branch}${config.dryRun ? " (dry run)" : ""}`,
  );
  console.log(
    `  Identities: ${
      config.identities.map((i) => `${i.name} <${i.email}>`).join(", ")
    }`,
  );
  console.log(
    `  Schedule: ${Math.floor(config.schedule.start / 60)}:${
      String(config.schedule.start % 60).padStart(2, "0")
    } – ${Math.floor(config.schedule.end / 60)}:${
      String(config.schedule.end % 60).padStart(2, "0")
    } ${config.schedule.timezone}`,
  );
  console.log(
    `  Mode: ${
      config.inPlace ? "in-place" : `new branch herodotus/${config.branch}`
    }`,
  );
  console.log();

  const changes = await rewrite(config);

  if (config.dryRun) {
    console.log("Changes that would be applied:\n");
    for (const c of changes) {
      const origDate = new Date(parseInt(c.authorDate.split(" ")[0]) * 1000)
        .toISOString();
      const newDate = new Date(parseInt(c.newAuthorDate!.split(" ")[0]) * 1000)
        .toISOString();
      console.log(`  #${c.index + 1}: "${c.message}"`);
      console.log(
        `    Author:  ${c.originalAuthor.name} <${c.originalAuthor.email}> → ${
          c.newAuthor!.name
        } <${c.newAuthor!.email}>`,
      );
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
  Deno.exit(1);
});
