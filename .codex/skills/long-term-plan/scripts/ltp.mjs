#!/usr/bin/env node
import { resolve as resolvePath } from 'node:path';
import {
  createPlan,
  getPlan,
  getTask,
  listPlans,
  repairPlanDoc,
  searchTasks,
  taskAdd,
  taskDelete,
  taskUpdate,
  validatePlanDoc,
} from './lib/todo/api.js';
import { DEFAULT_PLANS_DIR } from './lib/todo/constants.js';

function helpText() {
  return [
    'ltp — long-term plan CLI (structured Markdown)',
    '',
    'Usage:',
    '  ltp [--root <dir>] [--plans <dir>] <cmd>',
    '',
    'Plan:',
    '  ltp plan list [--query <text>]',
    '  ltp plan get <planId> [--view tree|flat]',
    '  ltp plan create <planId> --title <text> [--template empty|basic]',
    '',
    'Task:',
    '  ltp task get <planId> [taskId]',
    '  ltp task next <planId>',
    '  ltp task add <planId> --title <text> [--status todo|doing|done] [--section A/B] [--parent <taskId>] [--before <taskId>]',
    '  ltp task update <planId> [taskId] [--status todo|doing|done] [--title <text>] [--allow-default] [--if-match <etag>]',
    '  ltp task start <planId> <taskId>',
    '  ltp task done <planId> <taskId>',
    '  ltp task delete <planId> <taskId> [--if-match <etag>]',
    '  ltp task search <planId> --query <text> [--status todo|doing|done] [--limit <n>]',
    '',
    'Doc:',
    '  ltp doc validate <planId>',
    '  ltp doc repair <planId> --actions addFormatHeader,addMissingIds [--dry-run] [--if-match <etag>]',
    '',
    'Notes:',
    `  Defaults: --root=${process.cwd()} --plans=${DEFAULT_PLANS_DIR}`,
    '  Output: JSON to stdout; errors to stderr.',
    '',
  ].join('\n');
}

function printHelp() {
  process.stdout.write(helpText());
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function takeFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return false;
  argv.splice(idx, 1);
  return true;
}

function takeOption(argv, flag) {
  const idxEq = argv.findIndex((arg) => arg.startsWith(`${flag}=`));
  if (idxEq !== -1) {
    const value = argv[idxEq].slice(flag.length + 1);
    argv.splice(idxEq, 1);
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  argv.splice(idx, 2);
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function assertNoUnknownFlags(argv) {
  const unknown = argv.find((arg) => arg.startsWith('--'));
  if (unknown) {
    throw new Error(`Unknown option: ${unknown}`);
  }
}

function parseSectionPath(value) {
  if (!value) return undefined;
  const parts = value
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseStatus(value, flagName) {
  if (!value) return undefined;
  if (value === 'todo' || value === 'doing' || value === 'done') return value;
  throw new Error(`Invalid ${flagName}: ${JSON.stringify(value)}`);
}

function parseView(value) {
  if (!value) return undefined;
  if (value === 'tree' || value === 'flat') return value;
  throw new Error(`Invalid --view: ${JSON.stringify(value)}`);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (takeFlag(argv, '--help') || takeFlag(argv, '-h') || argv.length === 0) {
    printHelp();
    return;
  }

  let rootDir = process.cwd();
  const rootArg = takeOption(argv, '--root');
  if (rootArg) rootDir = resolvePath(process.cwd(), rootArg);

  let plansDir = DEFAULT_PLANS_DIR;
  const plansArg = takeOption(argv, '--plans');
  if (plansArg) plansDir = plansArg;

  const config = { rootDir, plansDir };

  const cmd = argv.shift();
  if (!cmd) {
    printHelp();
    return;
  }

  if (cmd === 'help') {
    printHelp();
    return;
  }

  if (cmd === 'plan') {
    const sub = argv.shift();
    if (sub === 'list') {
      const query = takeOption(argv, '--query');
      assertNoUnknownFlags(argv);
      const plans = await listPlans(config, { query });
      printJson({ plans });
      return;
    }
    if (sub === 'get') {
      const planId = argv.shift();
      const view = parseView(takeOption(argv, '--view'));
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      const { plan, etag } = await getPlan(config, { planId, view });
      printJson({ plan, etag });
      return;
    }
    if (sub === 'create') {
      const planId = argv.shift();
      const title = takeOption(argv, '--title');
      const template = takeOption(argv, '--template') ?? undefined;
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      if (!title) throw new Error('Missing --title');
      if (template && template !== 'empty' && template !== 'basic') {
        throw new Error(`Invalid --template: ${JSON.stringify(template)}`);
      }
      const created = await createPlan(config, { planId, title, template });
      printJson(created);
      return;
    }
    throw new Error(`Unknown plan command: ${sub ?? '(missing)'}`);
  }

  if (cmd === 'task') {
    const sub = argv.shift();

    if (sub === 'get' || sub === 'next') {
      const planId = argv.shift();
      const taskId = sub === 'get' ? argv.shift() : undefined;
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      const { task, etag } = await getTask(config, { planId, taskId });
      printJson({ task, etag });
      return;
    }

    if (sub === 'add') {
      const planId = argv.shift();
      const title = takeOption(argv, '--title');
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
        status,
        sectionPath,
        parentTaskId,
        beforeTaskId,
        ifMatch,
      });
      printJson({ taskId, etag });
      return;
    }

    if (sub === 'update') {
      const planId = argv.shift();
      const taskId = argv.shift();
      const status = parseStatus(takeOption(argv, '--status'), '--status');
      const title = takeOption(argv, '--title');
      const allowDefaultTarget = takeFlag(argv, '--allow-default') || takeFlag(argv, '--allow-default-target');
      const ifMatch = takeOption(argv, '--if-match');
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      const { taskId: updatedTaskId, etag } = await taskUpdate(config, {
        planId,
        taskId,
        status,
        title,
        allowDefaultTarget,
        ifMatch,
      });
      printJson({ taskId: updatedTaskId, etag });
      return;
    }

    if (sub === 'start' || sub === 'done') {
      const planId = argv.shift();
      const taskId = argv.shift();
      const status = sub === 'start' ? 'doing' : 'done';
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      if (!taskId) throw new Error('Missing <taskId>');
      const { taskId: updatedTaskId, etag } = await taskUpdate(config, {
        planId,
        taskId,
        status,
      });
      printJson({ taskId: updatedTaskId, etag });
      return;
    }

    if (sub === 'delete') {
      const planId = argv.shift();
      const taskId = argv.shift();
      const ifMatch = takeOption(argv, '--if-match');
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      if (!taskId) throw new Error('Missing <taskId>');
      const { etag } = await taskDelete(config, { planId, taskId, ifMatch });
      printJson({ etag });
      return;
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
      printJson({ hits });
      return;
    }

    throw new Error(`Unknown task command: ${sub ?? '(missing)'}`);
  }

  if (cmd === 'doc') {
    const sub = argv.shift();

    if (sub === 'validate') {
      const planId = argv.shift();
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      const { errors, warnings } = await validatePlanDoc(config, { planId });
      printJson({ errors, warnings });
      return;
    }

    if (sub === 'repair') {
      const planId = argv.shift();
      const actionsRaw = takeOption(argv, '--actions');
      const dryRun = takeFlag(argv, '--dry-run');
      const ifMatch = takeOption(argv, '--if-match');
      assertNoUnknownFlags(argv);
      if (!planId) throw new Error('Missing <planId>');
      if (!actionsRaw) throw new Error('Missing --actions');
      const actions = actionsRaw
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      for (const a of actions) {
        if (a !== 'addFormatHeader' && a !== 'addMissingIds') {
          throw new Error(`Invalid repair action: ${JSON.stringify(a)}`);
        }
      }
      const { etag, applied } = await repairPlanDoc(config, {
        planId,
        actions,
        dryRun,
        ifMatch,
      });
      printJson({ etag, applied });
      return;
    }

    throw new Error(`Unknown doc command: ${sub ?? '(missing)'}`);
  }

  throw new Error(`Unknown command: ${cmd}`);
}

try {
  await main();
} catch (error) {
  fail(error?.message || String(error));
  process.stderr.write('\n');
  printHelp();
}
