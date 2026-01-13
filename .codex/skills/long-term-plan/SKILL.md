---
name: long-term-plan
description: "Daily long-term plan CLI: list/open plans, add/update tasks, mark doing/done, search, and validate/repair."
---

# long-term-plan

Use the bundled `ltp` CLI to manage long-term plans (roadmaps/backlogs) stored as structured Markdown, without creating noisy diffs.

## CLI

- Run: `./.codex/skills/long-term-plan/scripts/ltp --help`
- Optional: `export PATH="$PWD/.codex/skills/long-term-plan/scripts:$PATH"` then run `ltp ...`
- Output is JSON; use `node -p` (or `jq`) to extract fields.

## Concepts

- A “plan” is a Markdown file named `<planId>.md` under `.long-term-plan/` (default).
- A “task” has a stable id in the trailing comment (`long-term-plan:id=...`); copy ids from `ltp` output.

## Always

- Prefer `ltp` over manual Markdown edits.
- Keep task IDs stable (never hand-edit `long-term-plan:id=...`).
- Use only the allowed status markers: `[ ]` todo, `[*]` doing, `[√]` done.
- Use 2-space indentation per subtask level.

## Common commands

- Plans:
  - `ltp plan list [--query "..."]`
  - `ltp plan get <planId> [--view tree|flat]` (includes `etag`)
  - `ltp plan create <planId> --title "..." [--template empty|basic]`
- Tasks:
  - `ltp task next <planId>` (pick what to work on)
  - `ltp task add <planId> --title "..." [--status todo|doing|done] [--section A/B] [--parent <taskId>] [--before <taskId>]`
  - `ltp task update <planId> <taskId> [--status todo|doing|done] [--title "..."] [--if-match <etag>]`
  - `ltp task start <planId> <taskId>` / `ltp task done <planId> <taskId>`
  - `ltp task delete <planId> <taskId> [--if-match <etag>]`
  - `ltp task search <planId> --query "..." [--status todo|doing|done] [--limit <n>]`
- Docs:
  - `ltp doc validate <planId>`
  - `ltp doc repair <planId> --actions addFormatHeader,addMissingIds [--dry-run] [--if-match <etag>]`

## Daily workflow (recommended)

1. Find next task: `ltp task next <planId>`
2. Start work: `ltp task start <planId> <taskId>`
3. Finish work: `ltp task done <planId> <taskId>`
4. Add follow-ups: `ltp task add <planId> --title "..." --section Inbox`

## Organize work (sections + subtasks)

- Put tasks under headings with `--section` (use `/` for nesting): `--section "Milestones/Q1"`
- Create subtasks with `--parent <taskId>` (indentation stays stable).
- Insert a task before another with `--before <taskId>`.
- Do not combine `--before` with `--parent` or `--section`.

## Safety rules (avoid wrong edits)

- When you need an explicit concurrency guard, read first and pass back `--if-match <etag>` on writes.
- Avoid “default target” writes unless you explicitly opt in: `ltp task update <planId> --allow-default --if-match <etag> ...`

## Practical JSON extraction

- Get `etag`: `ltp plan get <planId> | node -p 'JSON.parse(fs.readFileSync(0,\"utf8\")).etag'`
- Get selected task id: `ltp task next <planId> | node -p 'JSON.parse(fs.readFileSync(0,\"utf8\")).task.id'`

## If a plan file is broken

- Diagnose: `ltp doc validate <planId>`
- Repair (preview first): `ltp doc repair <planId> --actions addFormatHeader,addMissingIds --dry-run`

## Writing best practices (titles + structure)

- Write titles as a clear outcome (verb-first), not a vague bucket (avoid “misc”, “stuff”, “fix things”).
- Prefer sections for milestones/themes; use subtasks for checklists.
- Keep `doing` meaningful: it should represent active work (not “someday”).

## Extra tools (optional)

- `#sequential-thinking`: break risky changes into small, checkable steps.
- `#memory`: remember stable preferences (default plan, naming conventions, recurring sections).
