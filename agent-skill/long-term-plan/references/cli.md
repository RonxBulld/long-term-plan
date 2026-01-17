# CLI usage (`long-term-plan`)

`long-term-plan` is a local CLI for reading/writing long-term plan files stored as structured Markdown. It prints JSON to stdout (errors + usage to stderr).

Notation used in this doc:

- `<arg>`: required positional argument
- `[arg]`: optional positional argument
- `--flag <value>` / `--flag=value`: option value forms
- “predicates” / filters: options like `--query`, `--status`, and `--limit` that narrow results

ID rules:

- `<planId>` and `<taskId>` must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$` (1–128 chars).
- Plans are stored at: `<root>/<plans>/<planId>.md`

## Quick start

- Use the bundled CLI wrapper script located at `scripts/long-term-plan` within this skill's directory.
- Execute from the skill base path: `./scripts/long-term-plan --help`.
- Optional: add the skill's scripts directory to your `PATH` (from the skill base path): `export PATH="$PWD/scripts:$PATH"`.

Common scenarios:

- Create a plan → add tasks → pick what to work on:
  - `long-term-plan plan create demo --title "Demo Plan" --template basic`
  - `long-term-plan task add demo --title "Write docs"`
  - `long-term-plan task next demo`
- Add a task under a specific section heading path (creates headings at EOF if missing):
  - `long-term-plan task add demo --title "Ship v1" --section "Milestones/2026"`
- Safely edit an existing plan in a concurrent environment (see “Safe-write pattern (etag)”):
  - read `etag` first → pass it back via `--if-match` on writes

## Global flags

- `--root <dir>`: workspace root
  - Defaults: current directory (where you run `long-term-plan`).
  - All reads/writes are constrained to stay within `--root`.
  - Relative paths are resolved against your current working directory.
- `--plans <dir>`: plans directory **relative to** `--root`
  - Defaults: `.long-term-plan`.
  - Absolute `--plans` paths are rejected (they would escape `--root`).

## Plan commands

- List: `long-term-plan plan list [--query "..."]`
  - Defaults: `--query` omitted → list all plans.
  - Predicate: `--query` is a case-insensitive substring match over `(planId + title)`.
- Get: `long-term-plan plan get <planId> [--view tree|flat]`
  - Defaults: `--view=tree`.
  - `--view tree` returns nested tasks; `--view flat` returns a flat list of task summaries.
- Create: `long-term-plan plan create <planId> --title "..." [--template empty|basic]`
  - Defaults: `--template=basic`.
  - `--template basic` creates an `## Inbox` section; `empty` creates only the header + title.
- Update: `long-term-plan plan update <planId> [--title "..."] [--body <text>|--body-file <path>|--body-stdin|--clear-body] [--if-match <etag>]`
  - Defaults: none (no changes unless you pass a field).
  - Body flags are mutually exclusive; use only one of `--body`, `--body-file`, `--body-stdin`, `--clear-body`.

## Task commands

- Pick “next” task: `long-term-plan task next <planId>`
  - Defaults: pick the first `doing` task (top-to-bottom order); otherwise pick the first task that is not `done`.
- Get a task: `long-term-plan task get <planId> [taskId]`
  - Defaults: omit `taskId` → pick the first `doing` task; otherwise the first task that is not `done`.
  - Includes the decoded task body (`bodyMarkdown`) by default when present.
- Add: `long-term-plan task add <planId> --title "..." [--status todo|doing|done] [--section <path>] [--parent <taskId>] [--before <taskId>] [--if-match <etag>]`
  - Defaults: `--status=todo`; no placement flags → insert at end-of-file; `--if-match` omitted → no concurrency guard.
  - Optional body flags: `--body <text>|--body-file <path>|--body-stdin` (mutually exclusive).
  - `--section "A/B/C"` is a heading path (uses Markdown `##` for `A`, `###` for `B`, etc.).
  - Placement rules (highest priority first):
    - `--before <taskId>` inserts immediately before that task (as a sibling).
    - `--parent <taskId>` inserts as the last child of that task.
    - `--section <path>` inserts under that section (creating headings at EOF if missing).
    - otherwise inserts at end-of-file.
  - Do not combine `--before` with `--parent` or `--section`.
- Update: `long-term-plan task update <planId> [taskId] [--status todo|doing|done] [--title "..."] [--body <text>|--body-file <path>|--body-stdin|--clear-body] [--allow-default] [--if-match <etag>]`
  - Defaults: `--allow-default` is off; `--if-match` omitted → no concurrency guard.
  - At least one of `--status`, `--title`, `--body*`, or `--clear-body` is required.
  - Body flags are mutually exclusive; use only one of `--body`, `--body-file`, `--body-stdin`, `--clear-body`.
  - `--allow-default-target` is accepted as an alias for `--allow-default`.
  - If `taskId` is omitted, you must pass `--allow-default` and `--if-match`.
  - Default-target rule (when `taskId` is omitted):
    - Prefer the first `doing` task.
    - Otherwise, use the first unfinished task.
    - If there are multiple `doing` tasks, default-target writes are rejected as ambiguous.
- Convenience: `long-term-plan task start <planId> <taskId>` / `long-term-plan task done <planId> <taskId>`
  - Defaults: set status to `doing`/`done` with no concurrency guard.
  - Shortcut wrappers around `task update` (they do not accept `--if-match`; use `task update` if you need concurrency guards).
- Delete: `long-term-plan task delete <planId> <taskId> [--if-match <etag>]`
  - Defaults: `--if-match` omitted → no concurrency guard.
- Search: `long-term-plan task search <planId> --query "..." [--status todo|doing|done] [--limit <n>]`
  - Defaults: `--status` omitted → any status; `--limit=50` (clamped to `1..500`).
  - Predicates:
    - `--query` is a case-insensitive substring match on task title.
    - `--status` filters to only tasks in that status.
    - `--limit` defaults to `50` and is clamped to `1..500`.

## Doc commands

- Validate: `long-term-plan doc validate <planId>`
  - Defaults: none.
  - Returns `{ errors, warnings }` (with 1-based line numbers when available).
- Repair: `long-term-plan doc repair <planId> --actions addFormatHeader,addMissingIds [--dry-run] [--if-match <etag>]`
  - Defaults: `--dry-run=false`; `--if-match` omitted → no concurrency guard.
  - `--actions` is a comma-separated list:
    - `addFormatHeader`: ensure `<!-- long-term-plan:format=v1 -->` exists near the top
    - `addMissingIds`: add missing `<!-- long-term-plan:id=... -->` trailers to task lines
  - Use `--dry-run` to preview what would change (no file write).

## Safe-write pattern (etag)

Use `etag` + `--if-match` for optimistic concurrency on write commands that support it (e.g. `task add/update/delete`, `doc repair`).

1. Read and capture the current `etag`:
   - `etag=$(long-term-plan plan get <planId> | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).etag')`
2. Write with guard (fails with `CONFLICT: etag mismatch ...` if the plan changed):
   - `long-term-plan task update <planId> <taskId> --status doing --if-match "$etag"`

## Practical JSON extraction

- Task id from “next”: `long-term-plan task next <planId> | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).task.id'`
- New task id from “add”: `long-term-plan task add <planId> --title "..." | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).taskId'`

## Body input examples

- From a file:
  - `long-term-plan task update demo t_xxx --body-file ./notes.md`
- From stdin (heredoc):
  - Example:

````bash
long-term-plan task update demo t_xxx --body-stdin <<'EOF'
- checklist item inside body (NOTE: not a long-term-plan task; it won't get a task id)

```ts
const x = 1
```
EOF
````
