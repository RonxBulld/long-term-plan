# CLI usage (`ltp`)

## Quick start

- Run: `./.codex/skills/long-term-plan/scripts/ltp --help`
- Optional: `export PATH="$PWD/.codex/skills/long-term-plan/scripts:$PATH"`

## Global flags

- `--root <dir>`: workspace root (default: current directory)
- `--plans <dir>`: plans directory relative to root (default: `.long-term-plan`)

## Plan commands

- List: `ltp plan list [--query "..."]`
- Get: `ltp plan get <planId> [--view tree|flat]`
- Create: `ltp plan create <planId> --title "..." [--template empty|basic]`

## Task commands

- Pick next task: `ltp task next <planId>`
- Get a task: `ltp task get <planId> [taskId]`
- Add: `ltp task add <planId> --title "..." [--status todo|doing|done] [--section A/B] [--parent <taskId>] [--before <taskId>]`
  - Do not combine `--before` with `--parent` or `--section`.
- Update: `ltp task update <planId> <taskId> [--status todo|doing|done] [--title "..."] [--if-match <etag>]`
  - Default-target update: `ltp task update <planId> --allow-default --if-match <etag> ...`
- Convenience: `ltp task start <planId> <taskId>` / `ltp task done <planId> <taskId>`
- Delete: `ltp task delete <planId> <taskId> [--if-match <etag>]`
- Search: `ltp task search <planId> --query "..." [--status todo|doing|done] [--limit <n>]`

## Doc commands

- Validate: `ltp doc validate <planId>`
- Repair: `ltp doc repair <planId> --actions addFormatHeader,addMissingIds [--dry-run] [--if-match <etag>]`

## Safe-write pattern (etag)

1. Read and capture the current `etag`:
   - `etag=$(ltp plan get <planId> | node -p 'JSON.parse(fs.readFileSync(0,\"utf8\")).etag')`
2. Write with guard:
   - `ltp task update <planId> <taskId> --status doing --if-match "$etag"`

## Practical JSON extraction

- Task id from “next”: `ltp task next <planId> | node -p 'JSON.parse(fs.readFileSync(0,\"utf8\")).task.id'`
- New task id from “add”: `ltp task add <planId> --title "..." | node -p 'JSON.parse(fs.readFileSync(0,\"utf8\")).taskId'`
