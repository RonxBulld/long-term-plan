---
name: long-term-plan
description: "Manage long-term plans (roadmaps/backlogs) in structured Markdown: list/open plans, add/update tasks, mark doing/done, search, validate/repair — via the bundled CLI or stdio server tools."
---

# long-term-plan

Use this skill to keep long-term plan edits consistent, safe, and low-noise.

## Quick start

- Run: `./long-term-plan/scripts/long-term-plan --help`
- Optional: `export PATH="$PWD/long-term-plan/scripts:$PATH"`
- Prefer CLI for local edits; prefer server mode when a host needs tool calls.

## Rules

- Prefer tool-driven edits (CLI/server) over manual Markdown edits.
- When creating a task/issue for later execution, always write a task body that makes it executable out of context (background + goals + acceptance/verification).
- When choosing a task to execute, avoid keyword-only `task search` (title-only substring match, limited hit list); prefer `task get` (by id/default) and/or `plan get` to browse.
- Do **not** try to create tasks by putting `- [ ] ...` lists into `--body`. `--body` is unstructured notes for a plan/task; checklists inside it are not parsed as long-term-plan tasks and will not get task ids. Create real tasks via `./long-term-plan/scripts/long-term-plan task add <planId> --title "..."` / `task.add(planId, ...)` (and use `--parent <taskId>` for subtasks).
- Keep task ids stable (never hand-edit `long-term-plan:id=...`).
- Use only the allowed status markers: `[ ]` (todo), `[*]` (doing), `[√]` (done).
- Indent subtasks by 2 spaces per level.

## Task body checklist (recommended)

When adding a task (issue), include a `body` / `bodyMarkdown` that frames the work so an agent can execute it correctly later, without relying on hidden context.

Minimum checklist (add what applies):

- **Background**: why this exists; relevant context and links.
- **Goal**: the end state in one sentence.
- **Detailed goals / scope**: concrete deliverables; non-goals if helpful.
- **Acceptance / verification**: how to prove it's done (tests/commands/manual steps + expected results).
- **Constraints / assumptions**: time/tech constraints, guardrails, and any assumptions made due to missing info.
- **Open questions** (if needed): what must be clarified before implementation.

Example (CLI `--body-stdin`):

```bash
./long-term-plan/scripts/long-term-plan task add <planId> --title "..." --body-stdin <<'EOF'
### Background
- ...

### Goal
- ...

### Detailed goals / scope
- ...

### Acceptance / verification
- Command(s): `...`
- Expected: `...`

### Constraints / assumptions
- ...

### Open questions
- ...
EOF
```

## Where to look

- CLI commands + examples: `references/cli.md`
- Markdown format reminders: `references/format-v1.md`
- Stdio server mode (tool integration): `references/server-mode.md`
