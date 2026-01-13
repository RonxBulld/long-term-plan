# Server mode (stdio)

Use server mode when an IDE/agent host needs structured plan/task tools over stdio.

## Run

- `npm run build`
- `node dist/cli.js --root . --plans .long-term-plan`

## Tools

- `plan.list` / `plan.get` / `plan.create`
- `task.get` / `task.add` / `task.update` / `task.delete` / `task.search`

## Safety

- Treat `planId` as required context for every call.
- Read first to obtain `etag`, then pass it back as `ifMatch` on writes.
- Avoid default-target writes unless you explicitly opt in and pass `ifMatch`.
