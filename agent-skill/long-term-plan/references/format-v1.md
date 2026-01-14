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

## Blockquote bodies (optional)

The validator treats any line that looks like a task list item (e.g. `- [ ] ...`) as a task candidate and requires a trailing id. To store arbitrary Markdown (checkboxes, code blocks, tables) as a task/plan description without affecting strict task validation, encode the description as a blockquote block.

### Task body

Store a task body immediately after the task line as an indented blockquote run (write with exactly `taskIndent + 2` spaces, then `>`):

```md
- [ ] Parent <!-- long-term-plan:id=t_parent -->
  > - [ ] checkbox in the body (not a task)
  >
  > ```ts
  > const x = 1
  > ```
  - [ ] Child <!-- long-term-plan:id=t_child -->
```

### Plan body

Store a plan-level description under the first `# ...` heading as a top-level blockquote run:

```md
# Plan title

> Any markdown here (including `- [ ]`) is treated as plan body.
```

## Minimal diffs

- Prefer tool/CLI edits over manual edits.
- If manual edits are unavoidable, change only the status box and/or the title text.
- Do not reorder tasks or rewrite sections unless explicitly requested.
