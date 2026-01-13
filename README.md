# long-term-plan-mcp

A structured Markdown todo plan manager for “dozens to thousands” of tasks, with two first-class interfaces:

- `ltp`: a local CLI for plan/task CRUD
- `long-term-plan-mcp`: a stdio server exposing plan/task tools to an MCP host

## Quick Start (Local)

```bash
npm install
npm run build
npm run install # sync skill lib agent-skill/long-term-plan/scripts/lib/
```

### CLI (`ltp`)

```bash
node dist/ltp.js plan list
node dist/ltp.js plan create demo --title "Demo Plan" --template basic
node dist/ltp.js task add demo --title "Write docs"
node dist/ltp.js task next demo
```

### Stdio server (`long-term-plan-mcp`)

```bash
node dist/cli.js --root . --plans .long-term-plan
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

Supports hierarchical tasks (2-space indentation) and sections (Markdown headings). The default plans directory is `.long-term-plan/` (relative to `--root`; override with `--plans`).

Convention: all `plan.*` / `task.*` / `doc.*` tool calls must explicitly provide `planId`; this project does not provide an implicit default plan when `planId` is omitted.
If `taskId` is omitted in `task.get`, it returns the first in-progress (`doing`) task; if none are in progress, it returns the first not-yet-done task from top to bottom.
You can also omit `taskId` in `task.update`, but you must provide `ifMatch` and set `allowDefaultTarget=true` to avoid accidental edits; if multiple tasks are in progress, default targeting is rejected as ambiguous.

## Server tools (stdio)

- `plan.list` / `plan.get` / `plan.create`
- `task.get` / `task.add` / `task.update` / `task.delete` / `task.search`

## Important Behavioral Guarantees

- After any write-type tool call returns success, the persisted Markdown still conforms to `long-term-plan-md v1`, so a parser of the same version can always parse it.
- For files modified outside of MCP: they may become unparseable; write operations are rejected by default when the document has validation errors (repair manually, or via `doc.repair` when enabled). Exception: `task.add` may auto-add a missing format header if that is the only error.
- Reads/writes are constrained to `--root` (and `--plans` within it); paths that escape the configured root are rejected.

Compatibility: you can register the legacy `doc.validate`/`doc.repair` tools via `--legacy-doc-tools` (by default, `doc.*` is not exported, and no validate/repair tools are exported).
