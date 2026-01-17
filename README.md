# long-term-plan-mcp

A structured Markdown todo plan manager for “dozens to thousands” of tasks, with two first-class interfaces:

- `long-term-plan`: a local CLI for plan/task CRUD
- `long-term-plan-mcp`: a stdio server exposing plan/task tools to an MCP host

If you are using an agent host that supports Skills (Codex / Claude), the recommended way to use this project is via the included `long-term-plan` Skill (see `agent-skill/long-term-plan/SKILL.md`).

## Quick Start (Local)

```bash
npm install
npm run build
npm run skill:sync # sync the skill library into agent-skill/long-term-plan/scripts/lib/
```

Recommended when using Skills (Codex / Claude): copy the versioned skill(s) into your user skill directory:

```bash
npm run deploy # both (Codex + Claude)
npm run deploy:codex
npm run deploy:claude

# Overwrite existing deployed skill directories (note the `--` passthrough):
npm run deploy -- --force
```

### CLI (`long-term-plan`)

```bash
node dist/long-term-plan.js plan list
node dist/long-term-plan.js plan create demo --title "Demo Plan" --template basic
node dist/long-term-plan.js task add demo --title "Write docs"
node dist/long-term-plan.js task next demo
```

### Stdio server (`long-term-plan-mcp`)

```bash
node dist/cli.js --root . --plans .long-term-plan
```

Or run directly from GitHub (no local install / no `git pull`):

```bash
npx -y --package github:ronxbulld/long-term-plan long-term-plan-mcp --root . --plans .long-term-plan
```

Example MCP host config:

```json
{
  "mcpServers": {
    "long-term-plan": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "github:ronxbulld/long-term-plan",
        "long-term-plan-mcp",
        "--root",
        ".",
        "--plans",
        ".long-term-plan"
      ]
    }
  }
}
```

## long-term-plan-md v1 (Markdown Conventions)

Files must include a format header:

```md
<!-- long-term-plan:format=v1 -->
```

Task lines must include a stable ID (a trailing comment) and use fixed status symbols:

```md
- [ ] Not started <!-- long-term-plan:id=t_xxx -->
- [*] In progress <!-- long-term-plan:id=t_yyy -->
- [√] Done <!-- long-term-plan:id=t_zzz -->
```

Multi-line plan/task bodies are supported via **blockquote blocks** so arbitrary Markdown (checkboxes, code blocks, tables) does not get treated as a task line by the strict validator:

```md
# Plan title

> Plan description with `- [ ]` checkboxes is OK here.

- [ ] Task title <!-- long-term-plan:id=t_task -->
  > - [ ] checklist inside the task body
  >
  > ```ts
  > const x = 1
  > ```
```

Supports hierarchical tasks (2-space indentation) and sections (Markdown headings). The default plans directory is `.long-term-plan/` (relative to `--root`; override with `--plans`).

Convention: all `plan.*` / `task.*` / `doc.*` tool calls must explicitly provide `planId`; this project does not provide an implicit default plan when `planId` is omitted.
If `taskId` is omitted in `task.get`, it returns the first in-progress (`doing`) task; if none are in progress, it returns the first not-yet-done task from top to bottom.
You can also omit `taskId` in `task.update`, but you must provide `ifMatch` and set `allowDefaultTarget=true` to avoid accidental edits; if multiple tasks are in progress, default targeting is rejected as ambiguous.

## Server tools (stdio)

- `plan.list` / `plan.get` / `plan.create` / `plan.update`
- `task.get` / `task.add` / `task.update` / `task.delete` / `task.search`

## Important Behavioral Guarantees

- After any write-type tool call returns success, the persisted Markdown still conforms to `long-term-plan-md v1`, so a parser of the same version can always parse it.
- For files modified outside of MCP: they may become unparseable; write operations are rejected by default when the document has validation errors (repair manually, or via `doc.repair` when enabled). Exception: `task.add` may auto-add a missing format header if that is the only error.
- Reads/writes are constrained to `--root` (and `--plans` within it); paths that escape the configured root are rejected.

Compatibility: you can register the legacy `doc.validate`/`doc.repair` tools via `--legacy-doc-tools` (by default, `doc.*` is not exported, and no validate/repair tools are exported).
