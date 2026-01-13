# long-term-plan-mcp

A stdio server based on the **Model Context Protocol (MCP)** for managing todo plans at a “dozens to thousands” scale, with data stored in **structured Markdown**.

## Quick Start (Local)

```bash
npm install
npm run build
node dist/cli.js --root . --plans .long-term-plan
```

> As an MCP server, it is typically started by a host (IDE/Agent); this project uses stdio transport by default.

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
You can also omit `taskId` in `task.update`, but you must provide `ifMatch` and set `allowDefaultTarget=true` to avoid accidental edits.

## MCP Tools

- `plan.list` / `plan.get` / `plan.create`
- `task.get` / `task.add` / `task.update` / `task.delete` / `task.search`

## Important Behavioral Guarantees

- After any write-type tool call returns success, the persisted Markdown still conforms to `long-term-plan-md v1`, so a parser of the same version can always parse it.
- For files modified outside of MCP: they may become unparseable; in that case, write operations are rejected by default until the file is manually repaired into a valid `long-term-plan-md v1` format.
- Reads/writes are constrained to `--root` (and `--plans` within it); paths that escape the configured root are rejected.

Compatibility: you can register the legacy `doc.validate`/`doc.repair` tools via `--legacy-doc-tools` (by default, `doc.*` is not exported, and no validate/repair tools are exported).
