# Herodotus

> _"History is written by the victors."_

A git history rewriter that makes your commit log look like it was written by a
well-adjusted developer with healthy work habits.

## What it does

- **Rewrites authors** — Replaces all commit authors and committers with an
  identity of your choosing
- **Fixes your schedule** — Redistributes commit timestamps into realistic
  working hours (no more 3 AM commits)
- **Scrubs AI traces** — Strips `Co-Authored-By` trailers from Claude, Copilot,
  ChatGPT, and other AI assistants
- **Preserves the narrative** — Keeps commit order, relative pacing, and human
  co-author credits intact

## Quick start

Requires Node.js 24+ and git.

```bash
npm install
```

```bash
# Generate a config file
npm start -- init

# Run on the current repo (writes to herodotus/<branch>)
npm start

# Specify an identity
npm start -- -i "Ada Lovelace:ada@example.com"

# Preview changes without modifying anything
npm start -- --dry-run

# Rewrite in-place (creates a backup ref)
npm start -- --in-place
```

## Configuration

Drop a `.herodotus.toml` in your repo root:

```toml
[[identity]]
name = "Your Name"
email = "you@example.com"

[schedule]
start = "09:00"
end = "18:00"
timezone = "Europe/Bucharest"
allowedDays = ["Sat", "Sun"]
```

CLI flags override the config file. Without a config, Herodotus uses your
`git config` identity and a 9-to-6 schedule.

## CLI reference

```
herodotus [options] [<repo-path>]

  -i, --identity <name:email>   Identity to use (repeatable)
  -c, --config <file>           Config file (default: .herodotus.toml)
  -b, --branch <ref>            Branch to rewrite (default: HEAD)
      --start <HH:MM>           Workday start (default: 09:00)
      --end <HH:MM>             Workday end (default: 18:00)
      --timezone <tz>           IANA timezone (default: system)
  -d, --allowed-days <days>     Comma-separated days (default: Mon-Sat)
      --start-date <date>       First commit at this date (build forward)
      --end-date <date>         Last commit at this date (build backward, default: now)
      --in-place                Rewrite branch in-place with backup
      --dry-run                 Show changes without modifying
      --seed <number>           PRNG seed for reproducible output
  -h, --help                    Show help
```

## How it works

Herodotus pipes your branch through `git fast-export`, transforms the stream in
memory, and writes it back with `git fast-import`. No shell-per-commit overhead,
no Python dependency.

File contents are copied byte for byte. Commit messages recorded in another
encoding (an `encoding` header, e.g. from `i18n.commitEncoding=ISO-8859-1`) are
converted to UTF-8 via `fast-export --reencode=yes`, so rewritten commits carry
UTF-8 messages and no encoding header.

**Timestamps** are redistributed to preserve relative commit density while
snapping everything into your configured work window. A seeded PRNG adds subtle
jitter so the result doesn't look mechanical.

**Safety**: By default, Herodotus writes to a new local `herodotus/<branch>`
branch, leaving your original history untouched. This holds for any ref you pass
with `-b`, not only local branches: `-b origin/main` writes
`herodotus/origin/main` and leaves `refs/remotes/origin/main` alone.

In every mode, revisions that are not refs (a commit hash, `HEAD~2`, a detached
`HEAD`) and annotated tags are refused; create a branch from them first. A name
that is both a branch and a tag is refused as ambiguous; pass the full refname
(e.g. `-b refs/heads/release`).

Use `--in-place` to rewrite the given ref itself: the ref's original value is
kept in `refs/original/herodotus/<branch>`. This applies to whatever ref you
pass, so `--in-place -b origin/main` rewrites the remote-tracking ref
`refs/remotes/origin/main` (backed up first). Backups are never
overwritten; if that ref already exists (say, from an earlier in-place run), it
is left as is and the backup goes to a timestamped
`refs/original/herodotus/<branch>@<unix-ts>` instead. The output names the ref
that holds the backup.

## Install & test

```bash
npm link           # installs the `herodotus` command globally
npm test           # run the test suite
npm run typecheck  # type-check with tsc
```
