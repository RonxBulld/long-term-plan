# long-term-plan: MCP Todo Tool Design (v0)

## 1. Goals and Constraints

### Goals
- Write an **MCP Server** in **TypeScript**, launched via **npx** (stdio transport), to provide CRUD for todo plans.
- Target a scale of “dozens to thousands of tasks across multiple plan files”, ensuring **readable, writable, searchable, and extensible**.
- The **single source of truth** for data is structured Markdown files (human-readable, diff-friendly, and git-manageable).
- Use a careful content format and write strategy to **minimize formatting conflicts** (especially git merge conflicts and needless large diffs).

### Explicit constraints (from original requirements)
- Task status markers:
  - `[ ]`: not started / not done
  - `[*]`: in progress
  - `[√]`: done
- After Markdown files are modified **outside MCP**: correct parsing is not guaranteed (tools may reject/error/suggest repair, but are not required to tolerate arbitrary Markdown).

### Non-goals (v0: not implemented or optional)
- Do not treat Markdown as a database: no strong ACID guarantees, no complex query language, no cross-file transactions.
- Do not promise compatibility with every third-party Markdown task list syntax (e.g. `[x]` and other variants beyond `- [ ]`).

## 2. Repository and File Layout (Suggested)

```
./.long-term-plan/           # Plan directory (default + recommended)
  2026Q1.md
  product-roadmap.md
  config.json                # Optional: tool config (whether to commit is up to the team)
  index.json                 # Optional: index cache (recommended to gitignore)
```

> Convention: all `plan.*` / `task.*` / `doc.*` tool calls must explicitly provide `planId`; no implicit default plan when `planId` is omitted.

> Convention: by default, all write operations are only allowed under `root` (prevent path traversal), and only within `plansDir` (default `.long-term-plan/`).

## 3. Markdown Data Format (long-term-plan-md v1)

### 3.1 File-level format header (Required)
- The first paragraph (first few lines) of the file must include the format declaration:

```md
<!-- long-term-plan:format=v1 -->
```

### 3.2 Sections (Section)
- Use standard Markdown headings as sections (recommended to start from `##`):

```md
## Milestones
### Sprint 1
```

- The tool builds `sectionPath` from the heading hierarchy (e.g. `["Milestones","Sprint 1"]`).
- Heading text is editable by humans; **it is not a stable identifier** (stable references rely on `taskId`).

### 3.3 Task Lines (Task Line)

#### Syntax (Must satisfy)
A task must be an “unordered list item + status box + title + trailing ID comment”:

```md
- [ ] Task title <!-- long-term-plan:id=t_01HT... -->
```

- Unordered list marker: always use `-` (the tool writes using `-` uniformly).
- Status marker: only `[ ]` / `[*]` / `[√]` are allowed.
- `taskId`: declared in a trailing HTML comment, with the key fixed as `long-term-plan:id`.

#### taskId convention (Recommended)
- Format: `t_<ULID>` (e.g. `t_01HT8Y2...`), globally unique (preferably unique across files too).
- Allowed character set only: `[A-Za-z0-9_-]`, avoiding escaping and encoding differences.

#### Subtasks (Hierarchy)
- Express parent/child relationships via indentation and nested lists (tool writes with **2 spaces** per level):

```md
- [ ] Parent task <!-- long-term-plan:id=t_A -->
  - [ ] Child task <!-- long-term-plan:id=t_B -->
  - [√] Child task 2 <!-- long-term-plan:id=t_C -->
```

> Parsing rule: only list items that match the task-line syntax are recognized as Tasks; other list items at the same level or in sublevels are treated as notes/body text and are preserved but not structurally parsed.

### 3.4 Task body (Optional, preserved but not strongly parsed)
Free-form content can appear under a task line. Important: the validator treats any line that looks like a task list item (e.g. `- [ ] ...`) as a task candidate and requires a trailing id comment.

To store arbitrary Markdown (checkboxes, code blocks, tables) as a task body without impacting strict task validation, encode the body as a blockquote block under the task (see §10).

Example (blockquote body):

```md
- [*] Explore approaches <!-- long-term-plan:id=t_R -->
  > - [ ] checklist item (body, not a task)
  >
  > ```ts
  > // code fences and tables are allowed inside the body
  > ```
```

### 3.5 Conflict-minimizing write constraints (Key)
To minimize merge conflicts and large diffs, the write strategy follows:
- **Status updates**: only replace the 3-character `[...]` content in the task line; do not change other text or indentation.
- **Title updates**: only replace the “title area” between `[...]` and `<!-- long-term-plan:id=... -->`; do not change the comment or anything after it.
- **Adding tasks**: prefer appending at the end of the target section or parent task block to avoid global reordering; do not auto-sort.
- **Deleting tasks**: delete the task line plus its indented subtree (until indentation returns to the same or shallower level).
- **No formatting by default**: unless the user explicitly calls a `repair/format` tool, do not perform full-file normalization.

### 3.6 Detecting “non-MCP modifications”
- If the file is missing the format header, tasks are missing `taskId`, indentation structure cannot be determined, unknown status markers appear, etc.:
  - Read operations: may return `PARSE_ERROR` (including a locatable line range and reason)
  - Write operations: rejected by default (avoid compounding errors)
  - (Optional) provide `doc.validate` / `doc.repair` tools for explicit repair (not exported by default; only registered in compatibility mode)

## 4. Core implementation strategy (Testable/Maintainable)

### 4.1 Parsing: linear, line-based, locatable
- Instead of relying on a “full Markdown AST”, implement a **line-level parser**:
  - Recognize headings (`^#{1,6} `)
  - Recognize task lines (regex + trailing `long-term-plan:id`)
  - Build a tree using an indentation stack
  - Record `lineStart/lineEnd` and `indent` for each task to support minimal text patches
- Benefits: controllable performance, clear error localization, and easier “minimal diff” write-back.

### 4.2 Writing: atomic + optimistic concurrency control
- Each read returns an `etag` (e.g. `sha256(fileText)`).
- Write operations require the client to send `ifMatch`:
  - If `etag` does not match, return `CONFLICT` (prompt the client to re-read and retry)
- Write files using an atomic “temporary file + rename” replacement (within the same directory) to avoid partial writes.

## 5. MCP Server shape (npx launch)

### 5.1 Command form (Suggested)
- Package name (example): `long-term-plan-mcp`
- Launch command:
  - `npx long-term-plan-mcp --root . --plans .long-term-plan` (`--plans` can be omitted by default)
- Transport: stdio (fits common MCP deployment)

### 5.2 Config load precedence
1) CLI arguments
2) `.long-term-plan/config.json`
3) Defaults: `root=process.cwd()`, `plansDir=.long-term-plan`

### 5.3 Local CLI (`ltp`)

- Provide a normal command-line interface for plan/task CRUD (no host required).
- Output JSON to stdout (friendly to scripts and `jq`).
- Use the same core parsing/editing/validation logic as the stdio server to keep behavior in sync.

## 6. MCP tool interfaces (CRUD + validation)

> Naming suggestion: group by `plan.*` / `task.*` / `doc.*` to avoid future extension conflicts.

### 6.1 Plan (Plan files)
- `plan.list({ query?, limit?, cursor? }) -> { plans: PlanSummary[], nextCursor? }`
- `plan.get({ planId, view?: "tree"|"flat", includeTaskBodies?: boolean, includePlanBody?: boolean, limit?, cursor? }) -> { plan, etag, nextCursor? }`
- `plan.create({ planId, title, template?: "empty"|"basic", bodyMarkdown? }) -> { planId, path }`
- `plan.update({ planId, title?, bodyMarkdown?, clearBody?, ifMatch? }) -> { etag }`

PlanSummary (example)
```json
{
  "planId": "product-roadmap",
  "title": "Product Roadmap",
  "path": ".long-term-plan/product-roadmap.md",
  "stats": { "total": 120, "todo": 80, "doing": 3, "done": 37 }
}
```

### 6.2 Task (Tasks)
- `task.get({ planId, taskId?, includeBody?: boolean }) -> { task, etag }`
- `task.add({ planId, title, status?, bodyMarkdown?, sectionPath?, parentTaskId?, ifMatch }) -> { taskId, etag }`
- `task.update({ planId, taskId?, status?, title?, bodyMarkdown?, clearBody?, allowDefaultTarget?, ifMatch }) -> { etag, taskId }`
- `task.delete({ planId, taskId, ifMatch }) -> { etag }`
- `task.search({ planId, query, status?, limit?, cursor? }) -> { hits: TaskHit[], nextCursor? }`

Default behavior:
- If `taskId` is omitted: prefer the first `doing`; if none are `doing`, select the first not-yet-done task from top to bottom
- `task.get` defaults `includeBody=true`; `plan.get` defaults `includeTaskBodies=false` and `includePlanBody=false`

Write safety valve (recommended):
- If `task.update` omits `taskId`: must explicitly set `allowDefaultTarget=true` and provide `ifMatch` (etag) to avoid “target drift”

Status enum (recommended output)
```json
{ "status": "todo" | "doing" | "done" }
```
Write-back mapping:
- `todo` -> `[ ]`
- `doing` -> `[*]`
- `done` -> `[√]`

### 6.3 Doc (Format validation/repair)
- `doc.validate({ planId }) -> { errors: Diagnostic[], warnings: Diagnostic[] }`
- `doc.repair({ planId, actions: RepairAction[], dryRun?: boolean, ifMatch? }) -> { etag, applied }`

RepairAction (suggest starting with a minimal set)
- `addMissingIds`: add missing `long-term-plan:id` to task lines (needs strict rules to avoid false positives)
- `normalizeIndent`: normalize task indentation to 2 spaces (optional; can create large diffs; off by default)
- `normalizeStatusChar`: convert `[x]` / `[X]` etc. (if present) to `[√]` (optional)

## 7. Key edges and defense-in-depth design (Multi-layer validation)

1) **Entry validation (MCP params)**: `planId/path` only allow relative paths and whitelisted directories; reject `..` and absolute paths.
2) **File-level validation**: header, encoding (UTF-8), line ending compatibility (`\n`/`\r\n`).
3) **Structure-level validation**: unique taskId, valid indentation hierarchy, valid status markers.
4) **Write-level protection**: `etag ifMatch` conflict detection + atomic writes, avoiding concurrent overwrites and partial writes.

## 8. Extensibility points (v1+)
- Task attributes: `due`, `tags`, `estimate`, etc. (suggest keep them in trailing comments like `<!-- long-term-plan:id=... tags=a,b -->`, and keep a simple key=value grammar).
- Dependencies: `depends=t_xxx`, plus queries for “blocking/blocked by”.
- Workflow: `task.start` optional policy switch such as “only allow one doing per plan”.
- Index cache: `.long-term-plan/index.json` (speed only, not a source of truth).

## 9. Testing suggestions (Ensure testability)
- `parse(text) -> DocModel` as a pure function: cover indentation, sections, mixed body text, and invalid lines via test fixtures.
- `applyEdit(text, op) -> { newText, changedRanges }`: assert minimal diffs (only touch target lines).
- fixtures/golden: use real `.long-term-plan/*.md` samples for snapshot tests.

## 10. Blockquote bodies (Implementation-oriented spec)

This spec extends long-term-plan-md v1 with an on-disk body encoding that:
- stays within a single Markdown file
- allows arbitrary Markdown in bodies (checkboxes, code fences, tables)
- does not affect strict task-line validation (because body lines do not start with `-`)

### 10.1 On-disk encoding and boundary rules

#### 10.1.1 Task body (blockquote block)

**Purpose:** allow `bodyMarkdown` to contain arbitrary Markdown (including `- [ ]`) without producing `MISSING_TASK_ID` validation errors.

**On-disk location**
- The task body block is stored immediately after the strict task line, and before any child tasks or other content in that task block.
- Only the first contiguous task-body block is considered structured `bodyMarkdown`. Any later blockquote runs are treated as unstructured text.

**Write rule (encode)**
- Let `taskIndent` be the number of leading spaces on the strict task line.
- Each encoded body line MUST use exactly `taskIndent + 2` leading spaces.
- Encoding for each logical body line:
  - non-empty line `L` → `"{spaces}> {L}"`
  - empty line → `"{spaces}>"`

**Read rule (decode)**
- Starting at the line immediately after the strict task line:
  - A line is part of the task body iff:
    - it has `indent >= taskIndent + 2`, and
    - after trimming leading spaces it starts with `>`.
  - The body is the maximal contiguous run of such lines.
- For each encoded body line:
  - remove leading spaces
  - remove the first `>`
  - then remove one optional following space (so both `>` and `> ` are accepted)
- `bodyMarkdown` is the decoded lines joined with `\n` (preserving empty lines).

**Note on blank lines**
- Blank lines inside a body should be encoded as `>` lines. Plain blank lines are allowed in Markdown, but are not part of the structured body under this spec.

#### 10.1.2 Plan body (blockquote block)

**Purpose:** allow a plan-level description with arbitrary Markdown without affecting strict task validation.

**On-disk location**
- The plan body block is stored after the first H1 title line (`# ...`), after optional blank lines.
- The plan body ends at the first non-blockquote line.

**Write rule (encode)**
- Each encoded plan-body line is written at indentation level 0:
  - non-empty line `L` → `"> {L}"`
  - empty line → `">"`

**Read rule (decode)**
- Find the first H1 title line (`^#\s+`), then scan forward:
  - skip blank lines
  - if the next line is a blockquote line (`trimStart().startsWith('>')`), that begins the plan body
  - the plan body is the maximal contiguous run of blockquote lines
- Decode each plan-body line using the same `>` / optional space stripping rules as task bodies.

### 10.2 API and tool contract (field-level)

This section defines the proposed inputs/outputs for bodies. It is intentionally concrete so it can be implemented without guesswork.

#### 10.2.1 Tool inputs (new/updated fields)

| Tool | Field | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `task.get` | `includeBody` | `boolean` | `true` | When `false`, omit `task.bodyMarkdown` but still return `task.hasBody`. |
| `plan.get` | `includeTaskBodies` | `boolean` | `false` | When `true`, include per-task `bodyMarkdown` (can be large). |
| `plan.get` | `includePlanBody` | `boolean` | `false` | When `true`, include `plan.bodyMarkdown`. |
| `task.add` | `bodyMarkdown` | `string` | _(omitted)_ | Raw Markdown (no `>` prefixes); encoded to a blockquote body on write. |
| `task.update` | `bodyMarkdown` | `string` | _(omitted)_ | Replace the structured body with this Markdown. |
| `task.update` | `clearBody` | `boolean` | `false` | If `true`, remove the structured body block. Must not be combined with `bodyMarkdown`. |
| `plan.create` | `bodyMarkdown` | `string` | _(omitted)_ | Optional plan-level body placed under the H1 title. |
| `plan.update` | `bodyMarkdown` | `string` | _(omitted)_ | Replace the plan-level body with this Markdown. |
| `plan.update` | `clearBody` | `boolean` | `false` | Remove the plan-level body. Must not be combined with `bodyMarkdown`. |

#### 10.2.2 Body normalization (write)

- `bodyMarkdown` is treated as raw text and MAY contain any characters, including newlines.
- Implementations SHOULD normalize line endings to `\n` before encoding to blockquote lines.

### 10.3 JSON output contract (field lists)

All tools return an `etag` sibling to the main object (`plan` or `task`), as today.

#### 10.3.1 `plan.get` output (`view="tree"`)

`{ plan, etag }` where `plan` has:

| Field | Type | Presence | Notes |
| --- | --- | --- | --- |
| `planId` | `string` | always | |
| `title` | `string` | always | From the first H1 title line. |
| `format` | `{ name: "long-term-plan-md", version: "v1" }` | always | |
| `stats` | `{ total:number, todo:number, doing:number, done:number }` | always | |
| `view` | `"tree"` | always | |
| `hasBody` | `boolean` | always | `true` iff a plan body block exists on disk. |
| `bodyMarkdown` | `string` | when `includePlanBody && hasBody` | Decoded plan body Markdown (no `>` prefixes). |
| `tasks` | `TaskTreeNode[]` | always | |

`TaskTreeNode` fields:

| Field | Type | Presence | Notes |
| --- | --- | --- | --- |
| `id` | `string` | always | Stable `t_...` id. |
| `title` | `string` | always | Single-line title from the strict task line. |
| `status` | `"todo" \| "doing" \| "done"` | always | |
| `sectionPath` | `string[]` | always | Heading path, excluding H1. |
| `parentId` | `string` | when nested | |
| `hasBody` | `boolean` | always | `true` iff a task body block exists on disk. |
| `bodyMarkdown` | `string` | when `includeTaskBodies && hasBody` | Decoded task body Markdown (no `>` prefixes). |
| `children` | `TaskTreeNode[]` | always | |

#### 10.3.2 `plan.get` output (`view="flat"`)

`plan.tasks` is a list of `TaskFlatRow`:

| Field | Type | Presence | Notes |
| --- | --- | --- | --- |
| `id` | `string` | always | |
| `title` | `string` | always | |
| `status` | `"todo" \| "doing" \| "done"` | always | |
| `sectionPath` | `string[]` | always | |
| `parentId` | `string` | when nested | |
| `hasBody` | `boolean` | always | |
| `bodyMarkdown` | `string` | when `includeTaskBodies && hasBody` | May be large; prefer `task.get` for interactive use. |

#### 10.3.3 `task.get` output

`{ task, etag }` where `task` has:

| Field | Type | Presence | Notes |
| --- | --- | --- | --- |
| `id` | `string` | always | |
| `title` | `string` | always | |
| `status` | `"todo" \| "doing" \| "done"` | always | |
| `sectionPath` | `string[]` | always | |
| `parentId` | `string` | when nested | |
| `childrenCount` | `number` | always | Direct children count. |
| `hasBody` | `boolean` | always | |
| `bodyMarkdown` | `string` | when `includeBody && hasBody` | Decoded task body Markdown (no `>` prefixes). |

### 10.4 Error messages (stable strings)

This table defines error messages that SHOULD be stable for automation/scripting. The current implementation uses plain thrown errors; these are the recommended message strings.

| Condition | Message |
| --- | --- |
| `task.update` called without any of `status/title/bodyMarkdown/clearBody` | `At least one of status, title, bodyMarkdown, or clearBody is required` |
| `plan.update` called without any of `title/bodyMarkdown/clearBody` | `At least one of title, bodyMarkdown, or clearBody is required` |
| `bodyMarkdown` combined with `clearBody=true` | `bodyMarkdown cannot be combined with clearBody` |
| `task.update` omits `taskId` without explicit opt-in | `taskId is required unless allowDefaultTarget=true` |
| `task.update` omits `taskId` without `ifMatch` | `ifMatch is required when taskId is omitted` |
| Default-target write but multiple doing tasks exist | `AMBIGUOUS: multiple doing tasks; provide taskId` |
| Optimistic concurrency etag mismatch | `CONFLICT: etag mismatch (current=<etag>, ifMatch=<etag>)` |
| Task id not found | `Task not found: <taskId>` |
| Plan already exists on create | `Plan already exists: <planId>` |
| Plan body requested/updated but no H1 exists | `Missing plan title heading (# ...)` |
| A write requires parsing but the plan is invalid | Newline-separated parse diagnostics in the form `<CODE>@<line>: <message>` (1-based lines), or `Failed to parse plan` |
