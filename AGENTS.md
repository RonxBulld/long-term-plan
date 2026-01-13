# Agent Notes

This repository contains `long-term-plan-mcp`, an MCP stdio server for managing todo plans stored in structured Markdown.

## Common commands

- `npm test` (build + run Node.js tests)
- `npm run build` (TypeScript compile to `dist/`)
- `npm run start` (run `dist/cli.js`)

## long-term-plan-md v1 format

- Files must include `<!-- long-term-plan:format=v1 -->` near the top.
- Task line syntax: `- [ ] Title <!-- long-term-plan:id=t_... -->`
- Allowed status markers: `[ ]` (todo), `[*]` (doing), `[√]` (done)
- Subtasks use 2-space indentation per level.

## Tool conventions

- Always pass `planId` to `plan.*` / `task.*` / `doc.*` tool calls (no implicit default plan).
- Prefer minimal diffs when editing Markdown tasks: update only the status box or the title region, without reformatting/reordering.

## Code size limit

- The count of non-blank, non-comment code lines in any single file MUST NOT exceed 500. If an existing file already exceeds this limit, do not increase it; refactor/split instead.

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
