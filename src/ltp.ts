#!/usr/bin/env node

/**
 * `long-term-plan` - local CLI for long-term-plan Markdown plans.
 *
 * This CLI is a first-class interface alongside the stdio server. Both share
 * the same core plan/task API so behavior stays in sync.
 *
 * Important: this module is imported by tests, so it must NOT auto-run when
 * imported. The bottom-of-file "isMain" guard ensures that.
 */

import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';

import {
  createPlan,
  getPlan,
  getTask,
  listPlans,
  planUpdate,
  repairPlanDoc,
  searchTasks,
  taskAdd,
  taskDelete,
  taskUpdate,
  validatePlanDoc,
} from './todo/api.js';
import { DEFAULT_PLANS_DIR } from './todo/constants.js';
import type { TaskStatus } from './todo/model.js';
import type { RepairAction } from './todo/repair.js';

type PlanView = 'tree' | 'flat';
type PlanTemplate = 'empty' | 'basic';

type CliConfig = {
  rootDir: string;
  plansDir: string;
};

export interface LtpIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/**
 * Render CLI help text.
 *
 * Keep this stable and human-readable: tests and users often depend on it.
 */
function helpText(defaultRoot: string): string {
  return [
    'long-term-plan — long-term plan CLI (structured Markdown)',
    '',
    'Usage:',
    '  long-term-plan [--root <dir>] [--plans <dir>] <cmd>',
    '',
    'Plan:',
    '  long-term-plan plan list [--query <text>]',
    '  long-term-plan plan get <planId> [--view tree|flat]',
    '  long-term-plan plan create <planId> --title <text> [--template empty|basic]',
    '  long-term-plan plan update <planId> [--title <text>] [--body <text>|--body-stdin|--body-file <path>|--clear-body] [--if-match <etag>]',
    '',
    'Task:',
    '  long-term-plan task get <planId> [taskId]',
    '  long-term-plan task next <planId>',
    '  long-term-plan task add <planId> --title <text> [--status todo|doing|done] [--body <text>|--body-stdin|--body-file <path>] [--section A/B] [--parent <taskId>] [--before <taskId>] [--if-match <etag>]',
    '  long-term-plan task update <planId> [taskId] [--status todo|doing|done] [--title <text>] [--body <text>|--body-stdin|--body-file <path>|--clear-body] [--allow-default] [--if-match <etag>]',
    '  long-term-plan task start <planId> <taskId>',
    '  long-term-plan task done <planId> <taskId>',
    '  long-term-plan task delete <planId> <taskId> [--if-match <etag>]',
    '  long-term-plan task search <planId> --query <text> [--status todo|doing|done] [--limit <n>]',
    '',
    'Doc:',
    '  long-term-plan doc validate <planId>',
    '  long-term-plan doc repair <planId> --actions addFormatHeader,addMissingIds [--dry-run] [--if-match <etag>]',
    '',
    'Notes:',
    `  Defaults: --root=${defaultRoot} --plans=${DEFAULT_PLANS_DIR}`,
    '  Note: --body-file paths are resolved relative to the current working directory (not --root).',
    '  Output: JSON to stdout; errors to stderr.',
    '',
  ].join('\n');
}

/**
 * Write help text to stdout.
 *
 * This is used both for explicit `--help` and for error fallback.
 */
function writeHelp(io: LtpIo, defaultRoot: string): void {
  io.stdout.write(helpText(defaultRoot));
}

/**
 * Write a JSON value to stdout (pretty-printed).
 *
 * The CLI prints structured JSON on stdout and reserves stderr for errors.
 */
function writeJson(io: LtpIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Consume a boolean flag from argv.
 *
 * Returns true if the flag was present and removed.
 */
function takeFlag(argv: string[], flag: string): boolean {
  const index = argv.indexOf(flag);
  if (index === -1) return false;
  argv.splice(index, 1);
  return true;
}

/**
 * Consume a `--flag value` or `--flag=value` option from argv.
 *
 * Returns undefined when absent. Throws if present but missing a value.
 */
function takeOption(argv: string[], flag: string): string | undefined {
  const indexEq = argv.findIndex((arg) => arg.startsWith(`${flag}=`));
  if (indexEq !== -1) {
    const value = argv[indexEq]?.slice(flag.length + 1);
    argv.splice(indexEq, 1);
    if (!value) throw new Error(`Missing value for ${flag}`);
    return value;
  }

  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  argv.splice(index, 2);
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

/**
 * Ensure there are no remaining `--unknown` flags in argv.
 *
 * Commands should call this after consuming all expected flags/options.
 */
function assertNoUnknownFlags(argv: string[]): void {
  const unknown = argv.find((arg) => arg.startsWith('--'));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
}

/**
 * Parse `--section A/B` into a normalized section path array.
 *
 * Returns undefined for empty/whitespace-only inputs.
 */
function parseSectionPath(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/**
 * Parse a task status string from a flag value.
 *
 * Throws with a flag-specific message when invalid.
 */
function parseStatus(value: string | undefined, flagName: string): TaskStatus | undefined {
  if (!value) return undefined;
  if (value === 'todo' || value === 'doing' || value === 'done') return value;
  throw new Error(`Invalid ${flagName}: ${JSON.stringify(value)}`);
}

/**
 * Parse `--view` into a supported plan view.
 */
function parseView(value: string | undefined): PlanView | undefined {
  if (!value) return undefined;
  if (value === 'tree' || value === 'flat') return value;
  throw new Error(`Invalid --view: ${JSON.stringify(value)}`);
}

/**
 * Parse `--template` into a supported plan template.
 */
function parseTemplate(value: string | undefined): PlanTemplate | undefined {
  if (!value) return undefined;
  if (value === 'empty' || value === 'basic') return value;
  throw new Error(`Invalid --template: ${JSON.stringify(value)}`);
}

/**
 * Parse `--actions` for `doc repair` into the supported repair action list.
 */
function parseRepairActions(value: string): RepairAction[] {
  return value
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((action) => {
      if (action === 'addFormatHeader' || action === 'addMissingIds') return action;
      throw new Error(`Invalid repair action: ${JSON.stringify(action)}`);
    });
}

/**
 * Read body input flags into an update payload.
 *
 * Supported sources:
 * - `--body` (inline string)
 * - `--body-file` (filesystem path)
 * - `--body-stdin` (read from stdin)
 * - `--clear-body` (explicitly remove existing body)
 */
async function takeBodyArgs(
  argv: string[],
  defaultRoot: string
): Promise<{ bodyMarkdown?: string; clearBody?: boolean }> {
  const clearBody = takeFlag(argv, '--clear-body');
  const bodyStdin = takeFlag(argv, '--body-stdin');
  const bodyFile = takeOption(argv, '--body-file');
  const bodyInline = takeOption(argv, '--body');

  const selected = [clearBody, bodyStdin, bodyFile !== undefined, bodyInline !== undefined].filter(
    Boolean
  ).length;
  if (selected > 1) {
    throw new Error('Body flags are mutually exclusive: use only one of --body, --body-file, --body-stdin, --clear-body');
  }

  if (clearBody) return { clearBody: true };
  if (bodyInline !== undefined) return { bodyMarkdown: bodyInline };
  if (bodyFile !== undefined) {
    const absolute = resolvePath(defaultRoot, bodyFile);
    return { bodyMarkdown: await readFileAsync(absolute, 'utf8') };
  }
  if (bodyStdin) return { bodyMarkdown: readFileSync(0, 'utf8') };

  return {};
}

/**
 * Parse global CLI options (`--root`, `--plans`) into an API config object.
 *
 * Commands share the same config shape as the MCP server.
 */
function takeCliConfig(argv: string[], defaultRoot: string): CliConfig {
  let rootDir = defaultRoot;
  const rootArg = takeOption(argv, '--root');
  if (rootArg) rootDir = resolvePath(defaultRoot, rootArg);

  let plansDir = DEFAULT_PLANS_DIR;
  const plansArg = takeOption(argv, '--plans');
  if (plansArg) plansDir = plansArg;

  return { rootDir, plansDir };
}

/**
 * Execute `long-term-plan plan ...` commands.
 */
async function handlePlanCommand(
  config: CliConfig,
  argv: string[],
  io: LtpIo,
  defaultRoot: string
): Promise<number> {
  const sub = argv.shift();
  if (sub === 'list') {
    const query = takeOption(argv, '--query');
    assertNoUnknownFlags(argv);
    const plans = await listPlans(config, { query });
    writeJson(io, { plans });
    return 0;
  }
  if (sub === 'get') {
    const planId = argv.shift();
    const view = parseView(takeOption(argv, '--view'));
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    const { plan, etag } = await getPlan(config, { planId, view });
    writeJson(io, { plan, etag });
    return 0;
  }
  if (sub === 'create') {
    const planId = argv.shift();
    const title = takeOption(argv, '--title');
    const template = parseTemplate(takeOption(argv, '--template'));
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    if (!title) throw new Error('Missing --title');
    const created = await createPlan(config, { planId, title, template });
    writeJson(io, created);
    return 0;
  }
  if (sub === 'update') {
    const planId = argv.shift();
    const title = takeOption(argv, '--title');
    const ifMatch = takeOption(argv, '--if-match');
    const { bodyMarkdown, clearBody } = await takeBodyArgs(argv, defaultRoot);
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    const { etag } = await planUpdate(config, { planId, title, bodyMarkdown, clearBody, ifMatch });
    writeJson(io, { etag });
    return 0;
  }
  throw new Error(`Unknown plan command: ${sub ?? '(missing)'}`);
}

/**
 * Execute `long-term-plan task ...` commands.
 */
async function handleTaskCommand(
  config: CliConfig,
  argv: string[],
  io: LtpIo,
  defaultRoot: string
): Promise<number> {
  const sub = argv.shift();

  if (sub === 'get' || sub === 'next') {
    const planId = argv.shift();
    const taskId = sub === 'get' ? argv.shift() : undefined;
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    const { task, etag } = await getTask(config, { planId, taskId });
    writeJson(io, { task, etag });
    return 0;
  }

  if (sub === 'add') {
    const planId = argv.shift();
    const title = takeOption(argv, '--title');
    const { bodyMarkdown } = await takeBodyArgs(argv, defaultRoot);
    const status = parseStatus(takeOption(argv, '--status'), '--status');
    const sectionPath = parseSectionPath(takeOption(argv, '--section'));
    const parentTaskId = takeOption(argv, '--parent');
    const beforeTaskId = takeOption(argv, '--before');
    const ifMatch = takeOption(argv, '--if-match');
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    if (!title) throw new Error('Missing --title');
    const { taskId, etag } = await taskAdd(config, {
      planId,
      title,
      bodyMarkdown,
      status,
      sectionPath,
      parentTaskId,
      beforeTaskId,
      ifMatch,
    });
    writeJson(io, { taskId, etag });
    return 0;
  }

  if (sub === 'update') {
    const planId = argv.shift();
    const taskId = argv.shift();
    const status = parseStatus(takeOption(argv, '--status'), '--status');
    const title = takeOption(argv, '--title');
    const { bodyMarkdown, clearBody } = await takeBodyArgs(argv, defaultRoot);
    const allowDefaultTarget =
      takeFlag(argv, '--allow-default') || takeFlag(argv, '--allow-default-target');
    const ifMatch = takeOption(argv, '--if-match');
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    const { taskId: updatedTaskId, etag } = await taskUpdate(config, {
      planId,
      taskId,
      status,
      title,
      bodyMarkdown,
      clearBody,
      allowDefaultTarget,
      ifMatch,
    });
    writeJson(io, { taskId: updatedTaskId, etag });
    return 0;
  }

  if (sub === 'start' || sub === 'done') {
    const planId = argv.shift();
    const taskId = argv.shift();
    const status: TaskStatus = sub === 'start' ? 'doing' : 'done';
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    if (!taskId) throw new Error('Missing <taskId>');
    const { taskId: updatedTaskId, etag } = await taskUpdate(config, { planId, taskId, status });
    writeJson(io, { taskId: updatedTaskId, etag });
    return 0;
  }

  if (sub === 'delete') {
    const planId = argv.shift();
    const taskId = argv.shift();
    const ifMatch = takeOption(argv, '--if-match');
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    if (!taskId) throw new Error('Missing <taskId>');
    const { etag } = await taskDelete(config, { planId, taskId, ifMatch });
    writeJson(io, { etag });
    return 0;
  }

  if (sub === 'search') {
    const planId = argv.shift();
    const query = takeOption(argv, '--query');
    const status = parseStatus(takeOption(argv, '--status'), '--status');
    const limitRaw = takeOption(argv, '--limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    if (!query) throw new Error('Missing --query');
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new Error(`Invalid --limit: ${JSON.stringify(limitRaw)}`);
    }
    const hits = await searchTasks(config, { planId, query, status, limit });
    writeJson(io, { hits });
    return 0;
  }

  throw new Error(`Unknown task command: ${sub ?? '(missing)'}`);
}

/**
 * Execute `long-term-plan doc ...` commands.
 */
async function handleDocCommand(config: CliConfig, argv: string[], io: LtpIo): Promise<number> {
  const sub = argv.shift();

  if (sub === 'validate') {
    const planId = argv.shift();
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    const { errors, warnings } = await validatePlanDoc(config, { planId });
    writeJson(io, { errors, warnings });
    return 0;
  }

  if (sub === 'repair') {
    const planId = argv.shift();
    const actionsRaw = takeOption(argv, '--actions');
    const dryRun = takeFlag(argv, '--dry-run');
    const ifMatch = takeOption(argv, '--if-match');
    assertNoUnknownFlags(argv);
    if (!planId) throw new Error('Missing <planId>');
    if (!actionsRaw) throw new Error('Missing --actions');
    const actions = parseRepairActions(actionsRaw);
    const { etag, applied } = await repairPlanDoc(config, { planId, actions, dryRun, ifMatch });
    writeJson(io, { etag, applied });
    return 0;
  }

  throw new Error(`Unknown doc command: ${sub ?? '(missing)'}`);
}

/**
 * Run the CLI with a provided argv array (excluding `node` and script path).
 *
 * Returns an exit code, but does not call `process.exit()`. This keeps the CLI
 * testable without relying on spawning child processes.
 */
export async function runLtpCli(
  args: string[],
  io: LtpIo = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  const argv = [...args];
  const defaultRoot = process.cwd();

  try {
    if (takeFlag(argv, '--help') || takeFlag(argv, '-h') || argv.length === 0) {
      writeHelp(io, defaultRoot);
      return 0;
    }

    const config = takeCliConfig(argv, defaultRoot);
    const cmd = argv.shift();
    if (!cmd || cmd === 'help') {
      writeHelp(io, defaultRoot);
      return 0;
    }

    if (cmd === 'plan') {
      return await handlePlanCommand(config, argv, io, defaultRoot);
    }

    if (cmd === 'task') {
      return await handleTaskCommand(config, argv, io, defaultRoot);
    }

    if (cmd === 'doc') {
      return await handleDocCommand(config, argv, io);
    }

    throw new Error(`Unknown command: ${cmd}`);
  } catch (error) {
    io.stderr.write(`${(error as Error | undefined)?.message || String(error)}\n`);
    io.stderr.write('\n');
    writeHelp(io, defaultRoot);
    return 1;
  }
}

const isMain = resolvePath(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (isMain) {
  const exitCode = await runLtpCli(process.argv.slice(2));
  if (exitCode !== 0) process.exitCode = exitCode;
}
