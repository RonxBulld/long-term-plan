---
name: long-term-plan
description: "Manage long-term plans (roadmaps/backlogs) in structured Markdown: list/open plans, add/update tasks, mark doing/done, search, validate/repair — via ltp CLI or stdio server tools."
---

# long-term-plan

Use this skill to keep long-term plan edits consistent, safe, and low-noise.

## Quick start

- Run: `./.codex/skills/long-term-plan/scripts/ltp --help`
- Optional: `export PATH="$PWD/.codex/skills/long-term-plan/scripts:$PATH"`
- Prefer CLI for local edits; prefer server mode when a host needs tool calls.

## Rules

- Prefer tool-driven edits (CLI/server) over manual Markdown edits.
- Keep task ids stable (never hand-edit `long-term-plan:id=...`).
- Use only the allowed status markers: `[ ]` (todo), `[*]` (doing), `[√]` (done).
- Indent subtasks by 2 spaces per level.

## Where to look

- CLI commands + examples: `references/cli.md`
- Markdown format reminders: `references/format-v1.md`
- Stdio server mode (tool integration): `references/server-mode.md`
