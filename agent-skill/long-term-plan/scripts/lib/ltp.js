#!/usr/bin/env node
/**
 * `ltp` - local CLI for long-term-plan Markdown plans.
 *
 * This CLI is a first-class interface alongside the stdio server. Both share
 * the same core plan/task API so behavior stays in sync.
 *
 * Important: this module is imported by tests, so it must NOT auto-run when
 * imported. The bottom-of-file "isMain" guard ensures that.
 */
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlan, getPlan, getTask, listPlans, repairPlanDoc, searchTasks, taskAdd, taskDelete, taskUpdate, validatePlanDoc, } from './todo/api.js';
import { DEFAULT_PLANS_DIR } from './todo/constants.js';
function helpText(defaultRoot) {
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
        '  ltp task add <planId> --title <text> [--status todo|doing|done] [--section A/B] [--parent <taskId>] [--before <taskId>] [--if-match <etag>]',
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
        `  Defaults: --root=${defaultRoot} --plans=${DEFAULT_PLANS_DIR}`,
        '  Output: JSON to stdout; errors to stderr.',
        '',
    ].join('\n');
}
function writeHelp(io, defaultRoot) {
    io.stdout.write(helpText(defaultRoot));
}
function writeJson(io, value) {
    io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function takeFlag(argv, flag) {
    const index = argv.indexOf(flag);
    if (index === -1)
        return false;
    argv.splice(index, 1);
    return true;
}
function takeOption(argv, flag) {
    const indexEq = argv.findIndex((arg) => arg.startsWith(`${flag}=`));
    if (indexEq !== -1) {
        const value = argv[indexEq]?.slice(flag.length + 1);
        argv.splice(indexEq, 1);
        if (!value)
            throw new Error(`Missing value for ${flag}`);
        return value;
    }
    const index = argv.indexOf(flag);
    if (index === -1)
        return undefined;
    const value = argv[index + 1];
    argv.splice(index, 2);
    if (!value || value.startsWith('--'))
        throw new Error(`Missing value for ${flag}`);
    return value;
}
function assertNoUnknownFlags(argv) {
    const unknown = argv.find((arg) => arg.startsWith('--'));
    if (unknown)
        throw new Error(`Unknown option: ${unknown}`);
}
function parseSectionPath(value) {
    if (!value)
        return undefined;
    const parts = value
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
}
function parseStatus(value, flagName) {
    if (!value)
        return undefined;
    if (value === 'todo' || value === 'doing' || value === 'done')
        return value;
    throw new Error(`Invalid ${flagName}: ${JSON.stringify(value)}`);
}
function parseView(value) {
    if (!value)
        return undefined;
    if (value === 'tree' || value === 'flat')
        return value;
    throw new Error(`Invalid --view: ${JSON.stringify(value)}`);
}
function parseTemplate(value) {
    if (!value)
        return undefined;
    if (value === 'empty' || value === 'basic')
        return value;
    throw new Error(`Invalid --template: ${JSON.stringify(value)}`);
}
function parseRepairActions(value) {
    return value
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .map((action) => {
        if (action === 'addFormatHeader' || action === 'addMissingIds')
            return action;
        throw new Error(`Invalid repair action: ${JSON.stringify(action)}`);
    });
}
/**
 * Run the CLI with a provided argv array (excluding `node` and script path).
 *
 * Returns an exit code, but does not call `process.exit()`. This keeps the CLI
 * testable without relying on spawning child processes.
 */
export async function runLtpCli(args, io = { stdout: process.stdout, stderr: process.stderr }) {
    const argv = [...args];
    const defaultRoot = process.cwd();
    try {
        if (takeFlag(argv, '--help') || takeFlag(argv, '-h') || argv.length === 0) {
            writeHelp(io, defaultRoot);
            return 0;
        }
        let rootDir = defaultRoot;
        const rootArg = takeOption(argv, '--root');
        if (rootArg)
            rootDir = resolvePath(defaultRoot, rootArg);
        let plansDir = DEFAULT_PLANS_DIR;
        const plansArg = takeOption(argv, '--plans');
        if (plansArg)
            plansDir = plansArg;
        const config = { rootDir, plansDir };
        const cmd = argv.shift();
        if (!cmd || cmd === 'help') {
            writeHelp(io, defaultRoot);
            return 0;
        }
        if (cmd === 'plan') {
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
                if (!planId)
                    throw new Error('Missing <planId>');
                const { plan, etag } = await getPlan(config, { planId, view });
                writeJson(io, { plan, etag });
                return 0;
            }
            if (sub === 'create') {
                const planId = argv.shift();
                const title = takeOption(argv, '--title');
                const template = parseTemplate(takeOption(argv, '--template'));
                assertNoUnknownFlags(argv);
                if (!planId)
                    throw new Error('Missing <planId>');
                if (!title)
                    throw new Error('Missing --title');
                const created = await createPlan(config, { planId, title, template });
                writeJson(io, created);
                return 0;
            }
            throw new Error(`Unknown plan command: ${sub ?? '(missing)'}`);
        }
        if (cmd === 'task') {
            const sub = argv.shift();
            if (sub === 'get' || sub === 'next') {
                const planId = argv.shift();
                const taskId = sub === 'get' ? argv.shift() : undefined;
                assertNoUnknownFlags(argv);
                if (!planId)
                    throw new Error('Missing <planId>');
                const { task, etag } = await getTask(config, { planId, taskId });
                writeJson(io, { task, etag });
                return 0;
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
                if (!planId)
                    throw new Error('Missing <planId>');
                if (!title)
                    throw new Error('Missing --title');
                const { taskId, etag } = await taskAdd(config, {
                    planId,
                    title,
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
                const allowDefaultTarget = takeFlag(argv, '--allow-default') || takeFlag(argv, '--allow-default-target');
                const ifMatch = takeOption(argv, '--if-match');
                assertNoUnknownFlags(argv);
                if (!planId)
                    throw new Error('Missing <planId>');
                const { taskId: updatedTaskId, etag } = await taskUpdate(config, {
                    planId,
                    taskId,
                    status,
                    title,
                    allowDefaultTarget,
                    ifMatch,
                });
                writeJson(io, { taskId: updatedTaskId, etag });
                return 0;
            }
            if (sub === 'start' || sub === 'done') {
                const planId = argv.shift();
                const taskId = argv.shift();
                const status = sub === 'start' ? 'doing' : 'done';
                assertNoUnknownFlags(argv);
                if (!planId)
                    throw new Error('Missing <planId>');
                if (!taskId)
                    throw new Error('Missing <taskId>');
                const { taskId: updatedTaskId, etag } = await taskUpdate(config, { planId, taskId, status });
                writeJson(io, { taskId: updatedTaskId, etag });
                return 0;
            }
            if (sub === 'delete') {
                const planId = argv.shift();
                const taskId = argv.shift();
                const ifMatch = takeOption(argv, '--if-match');
                assertNoUnknownFlags(argv);
                if (!planId)
                    throw new Error('Missing <planId>');
                if (!taskId)
                    throw new Error('Missing <taskId>');
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
                if (!planId)
                    throw new Error('Missing <planId>');
                if (!query)
                    throw new Error('Missing --query');
                if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
                    throw new Error(`Invalid --limit: ${JSON.stringify(limitRaw)}`);
                }
                const hits = await searchTasks(config, { planId, query, status, limit });
                writeJson(io, { hits });
                return 0;
            }
            throw new Error(`Unknown task command: ${sub ?? '(missing)'}`);
        }
        if (cmd === 'doc') {
            const sub = argv.shift();
            if (sub === 'validate') {
                const planId = argv.shift();
                assertNoUnknownFlags(argv);
                if (!planId)
                    throw new Error('Missing <planId>');
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
                if (!planId)
                    throw new Error('Missing <planId>');
                if (!actionsRaw)
                    throw new Error('Missing --actions');
                const actions = parseRepairActions(actionsRaw);
                const { etag, applied } = await repairPlanDoc(config, { planId, actions, dryRun, ifMatch });
                writeJson(io, { etag, applied });
                return 0;
            }
            throw new Error(`Unknown doc command: ${sub ?? '(missing)'}`);
        }
        throw new Error(`Unknown command: ${cmd}`);
    }
    catch (error) {
        io.stderr.write(`${error?.message || String(error)}\n`);
        io.stderr.write('\n');
        writeHelp(io, defaultRoot);
        return 1;
    }
}
const isMain = resolvePath(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (isMain) {
    const exitCode = await runLtpCli(process.argv.slice(2));
    if (exitCode !== 0)
        process.exitCode = exitCode;
}
//# sourceMappingURL=ltp.js.map