# Agent Notes

This repository contains `long-term-plan-mcp`, an MCP stdio server for managing todo plans stored in structured Markdown.

## Common commands

- `npm test` (build + run Node.js tests)
- `npm run build` (TypeScript compile to `dist/`)
- `npm run skill:sync` (build + distribute to `<PROJECT_ROOT>/agent-skill/long-term-plan/scripts/lib/`)
- `npm run deploy` (copy skills to both `~/.codex/skills/` and `~/.claude/skills/`)
- `npm run deploy -- --force` (overwrite existing deployed skill directories; npm passthrough)
- `npm run deploy:codex` (copy skills to `~/.codex/skills/`)
- `npm run deploy:claude` (copy skills to `~/.claude/skills/`)
- `npm run start` (run `dist/cli.js`)

## long-term-plan-md v1 format

- Files must include `<!-- long-term-plan:format=v1 -->` near the top.
- Task line syntax: `- [ ] Title <!-- long-term-plan:id=t_... -->`
- Allowed status markers: `[ ]` (todo), `[*]` (doing), `[√]` (done)
- Subtasks use 2-space indentation per level.

## Tool conventions

- Always pass `planId` to `plan.*` / `task.*` / `doc.*` tool calls (no implicit default plan).
- When choosing a task to execute, avoid relying on keyword-only `task.search` / `long-term-plan task search` (title-only substring match, limited hit list); prefer `task.get` (by id/default) and/or `plan.get` to browse.
- Prefer minimal diffs when editing Markdown tasks: update only the status box or the title region, without reformatting/reordering.
- In skill docs, keep CLI examples using `./long-term-plan/scripts/long-term-plan` (after deployment, there may be no `agent-skill/` directory).
- When changing code or docs, check implementation↔docs consistency (including `agent-skill/long-term-plan/**`).

## Code size limit

- The count of non-blank, non-comment code lines in any single file MUST NOT exceed 500. If an existing file already exceeds this limit, do not increase it; refactor/split instead.
- The count of non-blank, non-comment code lines in any single function MUST NOT exceed 150.
- The comment rate (comment lines ÷ non-blank lines) in any code file you edit MUST be at least 15%.

## Git commit message format

Use a Conventional Commits-style subject line:

```
<type>(<scope>)!: <subject>
```

- `type`: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `build`, `ci` (repo also uses `mcp` as a type in some commits).
- `scope`: optional, lowercase, short (e.g. `parser`, `server`, `cli`, `mcp`).
- `!`: optional; use for breaking changes (prefer also adding a `BREAKING CHANGE:` note in the body).
- `subject`: imperative mood, concise, no trailing period.

Examples:
- `feat!: require explicit planId`
- `fix(parser): handle mixed list items`
- `docs: update README`
