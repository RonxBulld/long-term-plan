---
name: long-term-plan
description: "Manage long-term plans (roadmaps/backlogs) in structured Markdown: list/open plans, add/update tasks, mark doing/done, search, validate/repair — via ltp CLI or stdio server tools."
---

# long-term-plan

Use this skill to keep long-term plan edits consistent, safe, and low-noise.

## Quick start

- Run: `./long-term-plan/scripts/ltp --help`
- If `ltp` conflicts with another binary on your system, use: `./long-term-plan/scripts/long-term-plan` (same CLI).
- Optional: `export PATH="$PWD/long-term-plan/scripts:$PATH"`
- Prefer CLI for local edits; prefer server mode when a host needs tool calls.

## Rules

- Prefer tool-driven edits (CLI/server) over manual Markdown edits.
- When choosing a task to execute, avoid keyword-only `task search` (title-only substring match, limited hit list); prefer `task get` (by id/default) and/or `plan get` to browse.
- Do **not** try to create tasks by putting `- [ ] ...` lists into `--body`. `--body` is unstructured notes for a plan/task; checklists inside it are not parsed as long-term-plan tasks and will not get task ids. Create real tasks via `ltp task add <planId> --title "..."` / `task.add(planId, ...)` (and use `--parent <taskId>` for subtasks).
- Keep task ids stable (never hand-edit `long-term-plan:id=...`).
- Use only the allowed status markers: `[ ]` (todo), `[*]` (doing), `[√]` (done).
- Indent subtasks by 2 spaces per level.

## Where to look

- CLI commands + examples: `references/cli.md`
- Markdown format reminders: `references/format-v1.md`
- Stdio server mode (tool integration): `references/server-mode.md`
