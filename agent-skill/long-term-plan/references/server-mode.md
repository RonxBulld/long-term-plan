# Server mode (stdio)

Use server mode when an IDE/agent host needs structured plan/task tools over stdio.

## Run

- `npm run build`
- `node dist/cli.js --root . --plans .long-term-plan`

## Tools

- `plan.list` / `plan.get` / `plan.create` / `plan.update`
- `task.get` / `task.add` / `task.update` / `task.delete` / `task.search`

Body fields (optional):
- `task.add` / `task.update` accept `bodyMarkdown` (stored on disk as an indented blockquote run under the task).
- `task.update` can clear the body via `clearBody=true`.
- `task.get` defaults `includeBody=true` (decoded `bodyMarkdown` returned when present).
- `plan.get` defaults `includeTaskBodies=false` and `includePlanBody=false` (use flags to include decoded bodies).
- `plan.create` can accept `bodyMarkdown` to set a plan-level blockquote body under the first H1.
- `plan.update` can update `title` and/or set/clear the plan-level blockquote body.

## Safety

- Treat `planId` as required context for every call.
- Read first to obtain `etag`, then pass it back as `ifMatch` on writes.
- Avoid default-target writes unless you explicitly opt in and pass `ifMatch`.
