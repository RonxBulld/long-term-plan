import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import type { LongTermPlanConfig } from '../config.js';
import type { TaskNode, TaskStatus } from './model.js';
import { parsePlanMarkdown, parseTaskLineStrict } from './parse.js';
import { applyAddTask, applyDelete, applyRename, applySetStatus } from './edit.js';
import { validatePlanMarkdown } from './validate.js';
import { repairPlanMarkdown, type RepairAction } from './repair.js';
import { LONG_TERM_PLAN_FORMAT_HEADER } from './constants.js';
import {
  assertSafeId,
  readPlanFile,
  resolvePlanPath,
  resolvePlansDir,
  sha256Hex,
  writeFileAtomic,
} from './storage.js';

export interface PlanStats {
  total: number;
  todo: number;
  doing: number;
  done: number;
}

export interface PlanSummary {
  planId: string;
  title: string;
  path: string;
  stats: PlanStats;
}

export interface ListPlansOptions {
  query?: string;
}

function normalizeQuery(query: string | undefined): string | undefined {
  const q = query?.trim();
  return q ? q.toLowerCase() : undefined;
}

function extractTitleFromText(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.*)$/);
    if (match) return (match[1] ?? '').trim() || undefined;
  }
  return undefined;
}

function computeStats(text: string): PlanStats {
  const stats: PlanStats = { total: 0, todo: 0, doing: 0, done: 0 };
  for (const line of text.split(/\r?\n/)) {
    const task = parseTaskLineStrict(line);
    if (!task) continue;
    stats.total += 1;
    const symbol = task.symbol;
    if (symbol === ' ') stats.todo += 1;
    else if (symbol === '*') stats.doing += 1;
    else stats.done += 1;
  }
  return stats;
}

function flattenTasks(rootTasks: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  const stack: TaskNode[] = [...rootTasks].reverse();
  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) continue;
    out.push(task);
    for (let index = task.children.length - 1; index >= 0; index -= 1) {
      const child = task.children[index];
      if (child) stack.push(child);
    }
  }
  return out;
}

export async function listPlans(
  config: LongTermPlanConfig,
  options: ListPlansOptions
): Promise<PlanSummary[]> {
  const plansDir = resolvePlansDir(config);
  try {
    await access(plansDir);
  } catch {
    return [];
  }

  const query = normalizeQuery(options.query);
  const entries = await readdir(plansDir, { withFileTypes: true });
  const summaries: PlanSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    const planId = basename(entry.name, '.md');
    try {
      assertSafeId('planId', planId);
    } catch {
      continue;
    }

    const absolutePath = resolvePlanPath(config, planId);
    const text = await readFile(absolutePath, 'utf8');
    const title = extractTitleFromText(text) ?? planId;
    const stats = computeStats(text);
    const path = relative(config.rootDir, absolutePath);

    if (query) {
      const haystack = `${planId}\n${title}`.toLowerCase();
      if (!haystack.includes(query)) continue;
    }

    summaries.push({ planId, title, path, stats });
  }

  summaries.sort((a, b) => a.planId.localeCompare(b.planId));
  return summaries;
}

export interface GetPlanOptions {
  planId: string;
  view?: 'tree' | 'flat';
}

export async function getPlan(
  config: LongTermPlanConfig,
  options: GetPlanOptions
): Promise<{ plan: unknown; etag: string }> {
  const { text, etag } = await readPlanFile(config, options.planId);
  const parsed = parsePlanMarkdown(text);
  if (!parsed.ok || !parsed.plan) {
    const message =
      parsed.errors.length > 0
        ? parsed.errors.map((d) => `${d.code}${d.line !== undefined ? `@${d.line + 1}` : ''}: ${d.message}`).join('\n')
        : 'Failed to parse plan';
    throw new Error(message);
  }

  const stats = computeStats(text);
  const view = options.view ?? 'tree';
  const tasks =
    view === 'tree'
      ? parsed.plan.rootTasks
      : flattenTasks(parsed.plan.rootTasks).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          sectionPath: task.sectionPath,
          parentId: task.parentId,
        }));

  const plan = {
    planId: options.planId,
    title: parsed.plan.title,
    format: { name: 'long-term-plan-md', version: 'v1' },
    stats,
    view,
    tasks,
  };

  return { plan, etag };
}

export interface CreatePlanOptions {
  planId?: string;
  title: string;
  template?: 'empty' | 'basic';
}

function slugifyPlanId(title: string): string {
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (ascii && /^[a-z0-9]/.test(ascii)) return ascii.slice(0, 64);
  return `plan-${Date.now().toString(36)}`;
}

export async function createPlan(
  config: LongTermPlanConfig,
  options: CreatePlanOptions
): Promise<{ planId: string; path: string }> {
  const planId = options.planId ?? slugifyPlanId(options.title);
  assertSafeId('planId', planId);

  const absolutePath = resolvePlanPath(config, planId);
  const plansDir = resolvePlansDir(config);
  await mkdir(plansDir, { recursive: true });

  try {
    await access(absolutePath);
    throw new Error(`Plan already exists: ${planId}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') throw error;
  }

  const title = options.title.trim() || planId;
  const template = options.template ?? 'basic';
  const parts: string[] = [LONG_TERM_PLAN_FORMAT_HEADER, '', `# ${title}`, ''];
  if (template === 'basic') {
    parts.push('## Inbox', '');
  }

  const text = `${parts.join('\n')}\n`;
  await writeFileAtomic(absolutePath, text);

  return { planId, path: relative(config.rootDir, absolutePath) };
}

export interface GetTaskOptions {
  planId: string;
  taskId: string;
}

export async function getTask(
  config: LongTermPlanConfig,
  options: GetTaskOptions
): Promise<{ task: unknown; etag: string }> {
  assertSafeId('taskId', options.taskId);
  const { text, etag } = await readPlanFile(config, options.planId);
  const parsed = parsePlanMarkdown(text);
  if (!parsed.ok || !parsed.plan) throw new Error('Failed to parse plan');
  const task = parsed.plan.tasksById.get(options.taskId);
  if (!task) throw new Error(`Task not found: ${options.taskId}`);

  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      sectionPath: task.sectionPath,
      parentId: task.parentId,
      childrenCount: task.children.length,
    },
    etag,
  };
}

function requireIfMatch(currentEtag: string, ifMatch: string | undefined): void {
  if (!ifMatch) return;
  if (ifMatch !== currentEtag) {
    throw new Error(`CONFLICT: etag mismatch (current=${currentEtag}, ifMatch=${ifMatch})`);
  }
}

export interface TaskAddOptions {
  planId: string;
  title: string;
  status?: TaskStatus;
  sectionPath?: string[];
  parentTaskId?: string;
  ifMatch?: string;
}

export async function taskAdd(
  config: LongTermPlanConfig,
  options: TaskAddOptions
): Promise<{ taskId: string; etag: string }> {
  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  const { taskId, newText } = applyAddTask(text, {
    title: options.title,
    status: options.status ?? 'todo',
    sectionPath: options.sectionPath,
    parentTaskId: options.parentTaskId,
  });

  await writeFileAtomic(absolutePath, newText);
  return { taskId, etag: sha256Hex(newText) };
}

export interface TaskSetStatusOptions {
  planId: string;
  taskId: string;
  status: TaskStatus;
  ifMatch?: string;
}

export async function taskSetStatus(
  config: LongTermPlanConfig,
  options: TaskSetStatusOptions
): Promise<{ etag: string }> {
  assertSafeId('taskId', options.taskId);
  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  const edit = applySetStatus(text, options.taskId, options.status);
  if (!edit.changed) return { etag };
  await writeFileAtomic(absolutePath, edit.newText);
  return { etag: sha256Hex(edit.newText) };
}

export interface TaskRenameOptions {
  planId: string;
  taskId: string;
  title: string;
  ifMatch?: string;
}

export async function taskRename(
  config: LongTermPlanConfig,
  options: TaskRenameOptions
): Promise<{ etag: string }> {
  assertSafeId('taskId', options.taskId);
  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  const edit = applyRename(text, options.taskId, options.title);
  if (!edit.changed) return { etag };
  await writeFileAtomic(absolutePath, edit.newText);
  return { etag: sha256Hex(edit.newText) };
}

export interface TaskDeleteOptions {
  planId: string;
  taskId: string;
  ifMatch?: string;
}

export async function taskDelete(
  config: LongTermPlanConfig,
  options: TaskDeleteOptions
): Promise<{ etag: string }> {
  assertSafeId('taskId', options.taskId);
  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  const edit = applyDelete(text, options.taskId);
  if (!edit.changed) return { etag };
  await writeFileAtomic(absolutePath, edit.newText);
  return { etag: sha256Hex(edit.newText) };
}

export interface SearchTasksOptions {
  query: string;
  status?: TaskStatus;
  planId?: string;
  limit?: number;
}

export async function searchTasks(
  config: LongTermPlanConfig,
  options: SearchTasksOptions
): Promise<
  {
    planId: string;
    taskId: string;
    title: string;
    status: TaskStatus;
    sectionPath: string[];
  }[]
> {
  const query = options.query.trim().toLowerCase();
  if (!query) return [];

  const planIds = options.planId
    ? [options.planId]
    : (await listPlans(config, {})).map((p) => p.planId);
  const limit = Math.max(1, Math.min(500, options.limit ?? 50));

  const hits: {
    planId: string;
    taskId: string;
    title: string;
    status: TaskStatus;
    sectionPath: string[];
  }[] = [];

  for (const planId of planIds) {
    const { text } = await readPlanFile(config, planId);
    const parsed = parsePlanMarkdown(text);
    if (!parsed.ok || !parsed.plan) continue;
    for (const task of parsed.plan.tasksById.values()) {
      if (hits.length >= limit) return hits;
      if (options.status && task.status !== options.status) continue;
      if (!task.title.toLowerCase().includes(query)) continue;
      hits.push({
        planId,
        taskId: task.id,
        title: task.title,
        status: task.status,
        sectionPath: task.sectionPath,
      });
    }
  }

  return hits;
}

export async function validatePlanDoc(
  config: LongTermPlanConfig,
  options: { planId: string }
): Promise<{ errors: { code: string; message: string; line?: number }[]; warnings: { code: string; message: string; line?: number }[] }> {
  const { text } = await readPlanFile(config, options.planId);
  const result = validatePlanMarkdown(text);
  return {
    errors: result.errors.map((d) => ({
      code: d.code,
      message: d.message,
      line: d.line !== undefined ? d.line + 1 : undefined,
    })),
    warnings: result.warnings.map((d) => ({
      code: d.code,
      message: d.message,
      line: d.line !== undefined ? d.line + 1 : undefined,
    })),
  };
}

export async function repairPlanDoc(
  config: LongTermPlanConfig,
  options: {
    planId: string;
    actions: RepairAction[];
    dryRun?: boolean;
    ifMatch?: string;
  }
): Promise<{ etag: string; applied: { addFormatHeader: boolean; addMissingIds: number } }> {
  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  const repaired = repairPlanMarkdown(text, options.actions);
  if (!options.dryRun) {
    await writeFileAtomic(absolutePath, repaired.newText);
  }

  return { etag: sha256Hex(repaired.newText), applied: repaired.applied };
}
