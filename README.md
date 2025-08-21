# Herodotus

> *"History is written by the victors."*

A git history rewriter that makes your commit log look like it was written by a well-adjusted developer with healthy work habits.

## What it does

- **Rewrites authors** — Replaces all commit authors and committers with an identity of your choosing
- **Fixes your schedule** — Redistributes commit timestamps into realistic working hours (no more 3 AM commits)
- **Scrubs AI traces** — Strips `Co-Authored-By` trailers from Claude, Copilot, ChatGPT, and other AI assistants
- **Preserves the narrative** — Keeps commit order, relative pacing, and human co-author credits intact

## Quick start

```bash
# Run on the current repo (writes to herodotus/<branch>)
bun run src/main.ts

# Specify an identity
bun run src/main.ts -i "Ada Lovelace:ada@example.com"

# Preview changes without modifying anything
bun run src/main.ts --dry-run

# Rewrite in-place (creates a backup ref)
bun run src/main.ts --in-place
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

CLI flags override the config file. Without a config, Herodotus uses your `git config` identity and a 9-to-6 schedule.

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

Herodotus pipes your branch through `git fast-export`, transforms the stream in memory, and writes it back with `git fast-import`. No shell-per-commit overhead, no Python dependency.

**Timestamps** are redistributed to preserve relative commit density while snapping everything into your configured work window. A seeded PRNG adds subtle jitter so the result doesn't look mechanical.

**Safety**: By default, Herodotus writes to a `herodotus/<branch>` branch, leaving your original history untouched. Use `--in-place` to rewrite directly (a backup ref is created automatically).

## Build

```bash
bun install
bun run build    # compiles to ./herodotus binary
bun test         # run the test suite
```

## License

MIT
