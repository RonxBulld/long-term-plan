# CLI usage (`ltp`)

`ltp` is a local CLI for reading/writing long-term plan files stored as structured Markdown. It prints JSON to stdout (errors + usage to stderr).

Notation used in this doc:

- `<arg>`: required positional argument
- `[arg]`: optional positional argument
- `--flag <value>` / `--flag=value`: option value forms
- “predicates” / filters: options like `--query`, `--status`, and `--limit` that narrow results

ID rules:

- `<planId>` and `<taskId>` must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$` (1–128 chars).
- Plans are stored at: `<root>/<plans>/<planId>.md`

## Quick start

- Run: `./.codex/skills/long-term-plan/scripts/ltp --help`
- Optional: `export PATH="$PWD/.codex/skills/long-term-plan/scripts:$PATH"`

Common scenarios:

- Create a plan → add tasks → pick what to work on:
  - `ltp plan create demo --title "Demo Plan" --template basic`
  - `ltp task add demo --title "Write docs"`
  - `ltp task next demo`
- Add a task under a specific section heading path (creates headings at EOF if missing):
  - `ltp task add demo --title "Ship v1" --section "Milestones/2026"`
- Safely edit an existing plan in a concurrent environment (see “Safe-write pattern (etag)”):
  - read `etag` first → pass it back via `--if-match` on writes

## Global flags

- `--root <dir>`: workspace root
  - Defaults: current directory (where you run `ltp`).
  - All reads/writes are constrained to stay within `--root`.
  - Relative paths are resolved against your current working directory.
- `--plans <dir>`: plans directory **relative to** `--root`
  - Defaults: `.long-term-plan`.
  - Absolute `--plans` paths are rejected (they would escape `--root`).

## Plan commands

- List: `ltp plan list [--query "..."]`
  - Defaults: `--query` omitted → list all plans.
  - Predicate: `--query` is a case-insensitive substring match over `(planId + title)`.
- Get: `ltp plan get <planId> [--view tree|flat]`
  - Defaults: `--view=tree`.
  - `--view tree` returns nested tasks; `--view flat` returns a flat list of task summaries.
- Create: `ltp plan create <planId> --title "..." [--template empty|basic]`
  - Defaults: `--template=basic`.
  - `--template basic` creates an `## Inbox` section; `empty` creates only the header + title.

## Task commands

- Pick “next” task: `ltp task next <planId>`
  - Defaults: pick the first `doing` task (top-to-bottom order); otherwise pick the first task that is not `done`.
- Get a task: `ltp task get <planId> [taskId]`
  - Defaults: omit `taskId` → pick the first `doing` task; otherwise the first task that is not `done`.
- Add: `ltp task add <planId> --title "..." [--status todo|doing|done] [--section <path>] [--parent <taskId>] [--before <taskId>] [--if-match <etag>]`
  - Defaults: `--status=todo`; no placement flags → insert at end-of-file; `--if-match` omitted → no concurrency guard.
  - `--section "A/B/C"` is a heading path (uses Markdown `##` for `A`, `###` for `B`, etc.).
  - Placement rules (highest priority first):
    - `--before <taskId>` inserts immediately before that task (as a sibling).
    - `--parent <taskId>` inserts as the last child of that task.
    - `--section <path>` inserts under that section (creating headings at EOF if missing).
    - otherwise inserts at end-of-file.
  - Do not combine `--before` with `--parent` or `--section`.
- Update: `ltp task update <planId> [taskId] [--status todo|doing|done] [--title "..."] [--allow-default] [--if-match <etag>]`
  - Defaults: `--allow-default` is off; `--if-match` omitted → no concurrency guard.
  - At least one of `--status` or `--title` is required.
  - `--allow-default-target` is accepted as an alias for `--allow-default`.
  - If `taskId` is omitted, you must pass `--allow-default` and `--if-match`.
  - Default-target rule (when `taskId` is omitted):
    - Prefer the first `doing` task.
    - Otherwise, use the first unfinished task.
    - If there are multiple `doing` tasks, default-target writes are rejected as ambiguous.
- Convenience: `ltp task start <planId> <taskId>` / `ltp task done <planId> <taskId>`
  - Defaults: set status to `doing`/`done` with no concurrency guard.
  - Shortcut wrappers around `task update` (they do not accept `--if-match`; use `task update` if you need concurrency guards).
- Delete: `ltp task delete <planId> <taskId> [--if-match <etag>]`
  - Defaults: `--if-match` omitted → no concurrency guard.
- Search: `ltp task search <planId> --query "..." [--status todo|doing|done] [--limit <n>]`
  - Defaults: `--status` omitted → any status; `--limit=50` (clamped to `1..500`).
  - Predicates:
    - `--query` is a case-insensitive substring match on task title.
    - `--status` filters to only tasks in that status.
    - `--limit` defaults to `50` and is clamped to `1..500`.

## Doc commands

- Validate: `ltp doc validate <planId>`
  - Defaults: none.
  - Returns `{ errors, warnings }` (with 1-based line numbers when available).
- Repair: `ltp doc repair <planId> --actions addFormatHeader,addMissingIds [--dry-run] [--if-match <etag>]`
  - Defaults: `--dry-run=false`; `--if-match` omitted → no concurrency guard.
  - `--actions` is a comma-separated list:
    - `addFormatHeader`: ensure `<!-- long-term-plan:format=v1 -->` exists near the top
    - `addMissingIds`: add missing `<!-- long-term-plan:id=... -->` trailers to task lines
  - Use `--dry-run` to preview what would change (no file write).

## Safe-write pattern (etag)

Use `etag` + `--if-match` for optimistic concurrency on write commands that support it (e.g. `task add/update/delete`, `doc repair`).

1. Read and capture the current `etag`:
   - `etag=$(ltp plan get <planId> | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).etag')`
2. Write with guard (fails with `CONFLICT: etag mismatch ...` if the plan changed):
   - `ltp task update <planId> <taskId> --status doing --if-match "$etag"`

## Practical JSON extraction

- Task id from “next”: `ltp task next <planId> | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).task.id'`
- New task id from “add”: `ltp task add <planId> --title "..." | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).taskId'`
