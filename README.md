# Herodotus

> _"History is written by the victors."_

Rewrites a git branch so it looks like the work of one well-adjusted developer:
your chosen identity, commits inside office hours, and no AI co-author
trailers.

```console
$ herodotus --dry-run -i "Ada Lovelace:ada@example.com" --timezone Europe/London \n    --end-date 2026-03-20T17:00:00Z --seed 1
Herodotus: rewriting main (dry run)
  Identities: Ada Lovelace <ada@example.com>
  Schedule: 9:00 – 18:00 Europe/London
  Mode: new branch herodotus/main

Changes that would be applied:

  #1: "feat: Add parser"
    Author:  Night Owl <owl@example.com> → Ada Lovelace <ada@example.com>
    Date:    2026-03-14T01:47:12.000Z → 2026-03-20T16:09:45.000Z

  #2: "fix: Handle empty input"
    Author:  Night Owl <owl@example.com> → Ada Lovelace <ada@example.com>
    Date:    2026-03-14T02:31:05.000Z → 2026-03-20T17:00:00.000Z
```

## What it changes

- Author and committer of every commit become one of your identities
  (picked at random per commit when you give several). Committer date equals
  author date.
- Timestamps move into the work window on allowed days. Relative spacing is
  kept: commits made in one sitting stay close, commits days apart stay days
  apart. Seeded jitter keeps it from looking mechanical.
- `Co-Authored-By` trailers from AI assistants (Claude, Copilot, ChatGPT,
  Codex, Cursor, Gemini Code Assist, Windsurf, Codeium, Tabnine, Amazon Q,
  `[bot]` accounts) are removed when the name or email identifies the tool.
  Human co-authors stay.
- Conventional commit subjects get their first letter capitalised
  (`fix: typo` becomes `fix: Typo`).

File contents are copied byte for byte. Commit messages stored in another
encoding are converted to UTF-8.

## Requirements

Node.js 26+ and git.

## Install

```bash
npm install # also builds dist/
npm link    # puts `herodotus` on your PATH
```

Without linking, run it as `npm start -- <args>`.

## Usage

```
herodotus [options] [<repo-path>]
herodotus init [-c <file>] [<repo-path>]
```

`<repo-path>` defaults to the current directory. `init` writes a
`.herodotus.toml` (or the file given with `-c`, relative to `<repo-path>`)
prefilled with your git identity and refuses to overwrite an existing one.

| Option                        | Default                         | Description                                         |
| ----------------------------- | ------------------------------- | --------------------------------------------------- |
| `-i, --identity <name:email>` | `git config user.name`/`.email` | Identity to use; repeat for several                 |
| `-c, --config <file>`         | `.herodotus.toml`               | Config file, relative to `<repo-path>`; must exist  |
| `-b, --branch <ref>`          | current branch                  | Branch or other ref to rewrite                      |
| `--start <HH:MM>`             | `09:00`                         | Workday start                                       |
| `--end <HH:MM>`               | `18:00`                         | Workday end                                         |
| `--timezone <tz>`             | system timezone                 | IANA timezone for hours, days and offsets           |
| `-d, --allowed-days <days>`   | `Mon,Tue,Wed,Thu,Fri,Sat`       | Comma-separated (`Mon` or `Monday`, any case)       |
| `--start-date <date>`         |                                 | Place the first commit here and build forward       |
| `--end-date <date>`           | now                             | Place the last commit here and build backward       |
| `--in-place`                  | off                             | Rewrite the ref itself instead of a new branch      |
| `--dry-run`                   | off                             | Print the changes without writing anything          |
| `--seed <n>`                  | current time                    | Non-negative integer seed for reproducible output   |
| `-h, --help`                  |                                 | Show help                                           |

`--start-date` and `--end-date` are mutually exclusive. Dates are anything
JavaScript's `Date` parses, e.g. `2026-01-05T09:00:00Z`. A date-time without
`Z` or an offset is read in the machine's local timezone, not `--timezone`.

With no `-i`, no `[[identity]]` in the config and no git `user.name` and
`user.email`, the run fails.

Errors are printed as one line on stderr, prefixed `herodotus:`, and exit with
code 1. This includes unknown options.

### Config file

CLI flags override the file field by field. Only the keys shown below are
allowed; unknown keys, an `[[identity]]` without a `name` or `email`, and
values of the wrong type are errors. As on the command line, a
`startDate`/`endDate` without `Z` or an offset is in the machine's local
timezone, not `timezone`.

```toml
[[identity]]
name = "Ada Lovelace"
email = "ada@example.com"

[schedule]
start = "09:00"
end = "18:00"
timezone = "Europe/Bucharest"
allowedDays = ["Mon", "Tue", "Wed", "Thu", "Fri"]
# startDate = "2026-01-05T07:00:00Z"
endDate = "2026-06-30T15:00:00Z"
```

### Where the result goes

By default the ref is left alone and the rewrite is written to a new local
branch `herodotus/<ref>`; `-b origin/main` writes `herodotus/origin/main`. The
run fails if that branch already exists.

With `--in-place` the ref itself is rewritten, after its old value is saved to
`refs/original/herodotus/<ref>`. This works on any ref, including
remote-tracking ones: `--in-place -b origin/main` backs up and then rewrites
`refs/remotes/origin/main`. An existing backup is never overwritten: the
new one goes to `refs/original/herodotus/<ref>@<unix-ts>`, and the output names
the ref used.

Both modes refuse:

- a dirty working tree (except with `--dry-run`)
- revisions that are not refs (a commit hash, `HEAD~2`, a detached `HEAD`)
- annotated tags
- names that are both a branch and a tag; pass the full refname, e.g.
  `-b refs/heads/release`

## How it works

The branch goes through `git fast-export --reencode=yes`, the stream is edited
in memory, and the result is fed to `git fast-import`. No per-commit shell
calls.

## Development

```bash
npm run dev        # run src/main.ts with --watch
npm test           # node:test, test/**/*.test.ts
npm run typecheck  # tsc
npm run lint       # biome lint
npm run format     # biome check --write
npm run check      # biome check, typecheck and tests
npm run build      # compile src/ to dist/
```
