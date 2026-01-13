# Format reminders (long-term-plan-md v1)

## File header

Include near the top of every plan file:

`<!-- long-term-plan:format=v1 -->`

## Task lines

Required shape:

`- [ ] Title <!-- long-term-plan:id=t_... -->`

Rules:

- Status markers allowed: `[ ]` (todo), `[*]` (doing), `[√]` (done)
- Keep task ids stable (never hand-edit `long-term-plan:id=...`)
- Subtasks: indent 2 spaces per level
- Sections: use Markdown headings (e.g. `## Inbox`, `## Milestones`)

## Minimal diffs

- Prefer tool/CLI edits over manual edits.
- If manual edits are unavoidable, change only the status box and/or the title text.
- Do not reorder tasks or rewrite sections unless explicitly requested.
