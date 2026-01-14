import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import type { LongTermPlanConfig } from '../config.js';
import type { TaskNode, TaskStatus } from './model.js';
import { parsePlanMarkdown, parseTaskLineStrict } from './parse.js';
import {
  applyAddTask,
  applyDelete,
  applyRename,
  applySetPlanBody,
  applySetPlanTitle,
  applySetStatus,
  applySetTaskBody,
} from './edit.js';
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
import { buildTaskTreeView, toTaskFlatRow } from './view.js';

/**
 * Public API for plan/task operations.
 *
 * This module is the boundary between:
 * - filesystem storage (`storage.ts`)
 * - parsing/validation/repair (`parse.ts`, `validate.ts`, `repair.ts`)
 * - minimal-diff editing (`edit.ts`)
 *
 * Concurrency model:
 * - Most mutating operations accept `ifMatch` (etag) for optimistic concurrency.
 * - The etag is a SHA-256 of the full document content.
 */
export interface PlanStats {
  total: number;
  todo: number;
  doing: number;
  done: number;
}

/**
 * Metadata returned by `listPlans()`.
 */
export interface PlanSummary {
  planId: string;
  title: string;
  path: string;
  stats: PlanStats;
}

export interface ListPlansOptions {
  query?: string;
}

/**
 * Normalize a search query for case-insensitive matching.
 */
function normalizeQuery(query: string | undefined): string | undefined {
  const q = query?.trim();
  return q ? q.toLowerCase() : undefined;
}

/**
 * Best-effort extraction of the plan title from an H1 heading.
 */
function extractTitleFromText(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.*)$/);
    if (match) return (match[1] ?? '').trim() || undefined;
  }
  return undefined;
}

/**
 * Compute basic status counts directly from raw text.
 *
 * This is intentionally line-based so we can compute stats even if the document
 * is not fully parseable.
 */
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

/**
 * Flatten a task tree into a stable traversal order.
 *
 * We use an explicit stack to avoid recursion depth issues on deeply nested plans.
 */
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

type DefaultTaskReason = 'doing' | 'unfinished';

function selectDefaultTaskId(
  rootTasks: TaskNode[],
  options: { mode: 'read' | 'write' }
): { taskId: string; reason: DefaultTaskReason } {
  const ordered = flattenTasks(rootTasks);

  const doingTasks = ordered.filter((task) => task.status === 'doing');
  if (options.mode === 'write' && doingTasks.length > 1) {
    throw new Error('AMBIGUOUS: multiple doing tasks; provide taskId');
  }
  if (doingTasks.length > 0) {
    return { taskId: doingTasks[0].id, reason: 'doing' };
  }

  const firstUnfinished = ordered.find((task) => task.status !== 'done');
  if (firstUnfinished) return { taskId: firstUnfinished.id, reason: 'unfinished' };

  throw new Error('No unfinished tasks in plan');
}

/**
 * List plan markdown files within `config.plansDir`.
 *
 * - Only files ending in `.md` are considered.
 * - Plan ids are derived from filename (basename) and validated for safety.
 */
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
  includeTaskBodies?: boolean;
  includePlanBody?: boolean;
}

/**
 * Read and parse a plan file.
 *
 * The `view` option controls the shape of the returned task list:
 * - `tree`: nested tasks with children
 * - `flat`: a simplified list of task summaries
 */
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
  const includeTaskBodies = options.includeTaskBodies ?? false;
  const includePlanBody = options.includePlanBody ?? false;
  const tasks =
    view === 'tree'
      ? buildTaskTreeView(parsed.plan.rootTasks, { includeBody: includeTaskBodies })
      : flattenTasks(parsed.plan.rootTasks).map((task) =>
          toTaskFlatRow(task, { includeBody: includeTaskBodies })
        );

  const plan: Record<string, unknown> = {
    planId: options.planId,
    title: parsed.plan.title,
    format: { name: 'long-term-plan-md', version: 'v1' },
    stats,
    view,
    hasBody: parsed.plan.hasBody,
    tasks,
  };
  if (includePlanBody && parsed.plan.hasBody) plan.bodyMarkdown = parsed.plan.bodyMarkdown;

  return { plan, etag };
}

export interface CreatePlanOptions {
  planId: string;
  title: string;
  template?: 'empty' | 'basic';
  bodyMarkdown?: string;
}

/**
 * Create a new plan markdown file.
 */
export async function createPlan(
  config: LongTermPlanConfig,
  options: CreatePlanOptions
): Promise<{ planId: string; path: string }> {
  const planId = options.planId;
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

  let text = `${parts.join('\n')}\n`;
  if (options.bodyMarkdown !== undefined) {
    text = applySetPlanBody(text, options.bodyMarkdown).newText;
  }
  await writeFileAtomic(absolutePath, text);

  return { planId, path: relative(config.rootDir, absolutePath) };
}

export interface GetTaskOptions {
  planId: string;
  taskId?: string;
  includeBody?: boolean;
}

/**
 * Load a single task from a plan.
 *
 * If `taskId` is omitted, we select a default task:
 * - Prefer the first `doing` task (top-to-bottom order).
 * - Otherwise, pick the first unfinished task.
 */
export async function getTask(
  config: LongTermPlanConfig,
  options: GetTaskOptions
): Promise<{ task: unknown; etag: string }> {
  const { text, etag } = await readPlanFile(config, options.planId);
  const parsed = parsePlanMarkdown(text);
  if (!parsed.ok || !parsed.plan) throw new Error('Failed to parse plan');

  const includeBody = options.includeBody ?? true;
  let task: TaskNode | undefined;
  if (options.taskId) {
    assertSafeId('taskId', options.taskId);
    task = parsed.plan.tasksById.get(options.taskId);
    if (!task) throw new Error(`Task not found: ${options.taskId}`);
  } else {
    const { taskId } = selectDefaultTaskId(parsed.plan.rootTasks, { mode: 'read' });
    task = parsed.plan.tasksById.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
  }

  const outTask: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
    sectionPath: task.sectionPath,
    parentId: task.parentId,
    childrenCount: task.children.length,
    hasBody: task.hasBody,
  };
  if (includeBody && task.hasBody) outTask.bodyMarkdown = task.bodyMarkdown;

  return { task: outTask, etag };
}

/**
 * Enforce optimistic concurrency when an `ifMatch` etag is provided.
 */
function requireIfMatch(currentEtag: string, ifMatch: string | undefined): void {
  if (!ifMatch) return;
  if (ifMatch !== currentEtag) {
    throw new Error(`CONFLICT: etag mismatch (current=${currentEtag}, ifMatch=${ifMatch})`);
  }
}

export interface TaskAddOptions {
  planId: string;
  title: string;
  bodyMarkdown?: string;
  status?: TaskStatus;
  sectionPath?: string[];
  parentTaskId?: string;
  beforeTaskId?: string;
  ifMatch?: string;
}

/**
 * Add a task to a plan document and return its generated id + new etag.
 */
export async function taskAdd(
  config: LongTermPlanConfig,
  options: TaskAddOptions
): Promise<{ taskId: string; etag: string }> {
  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  const { taskId, newText } = applyAddTask(text, {
    title: options.title,
    bodyMarkdown: options.bodyMarkdown,
    status: options.status ?? 'todo',
    sectionPath: options.sectionPath,
    parentTaskId: options.parentTaskId,
    beforeTaskId: options.beforeTaskId,
  });

  await writeFileAtomic(absolutePath, newText);
  return { taskId, etag: sha256Hex(newText) };
}

export interface TaskUpdateOptions {
  planId: string;
  taskId?: string;
  title?: string;
  status?: TaskStatus;
  bodyMarkdown?: string;
  clearBody?: boolean;
  ifMatch?: string;
  allowDefaultTarget?: boolean;
}

/**
 * Update a task in-place and return the new etag.
 *
 * - `status` and `title` are both optional, but at least one must be provided.
 * - If `taskId` is omitted, callers must set `allowDefaultTarget=true` and provide `ifMatch`.
 * - Default targeting prefers the current `doing` task, else the first unfinished task.
 */
export async function taskUpdate(
  config: LongTermPlanConfig,
  options: TaskUpdateOptions
): Promise<{ taskId: string; etag: string }> {
  if (options.bodyMarkdown !== undefined && options.clearBody) {
    throw new Error('bodyMarkdown cannot be combined with clearBody');
  }
  if (
    options.status === undefined &&
    options.title === undefined &&
    options.bodyMarkdown === undefined &&
    !options.clearBody
  ) {
    throw new Error('At least one of status, title, bodyMarkdown, or clearBody is required');
  }
  if (!options.taskId && !options.allowDefaultTarget) {
    throw new Error('taskId is required unless allowDefaultTarget=true');
  }
  if (!options.taskId && !options.ifMatch) {
    throw new Error('ifMatch is required when taskId is omitted');
  }

  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  let taskId = options.taskId;
  if (taskId) {
    assertSafeId('taskId', taskId);
  } else {
    const parsed = parsePlanMarkdown(text);
    if (!parsed.ok || !parsed.plan) throw new Error('Failed to parse plan');
    taskId = selectDefaultTaskId(parsed.plan.rootTasks, { mode: 'write' }).taskId;
  }

  let newText = text;
  let changed = false;

  if (options.status !== undefined) {
    const edit = applySetStatus(newText, taskId, options.status);
    newText = edit.newText;
    changed = changed || edit.changed;
  }

  if (options.title !== undefined) {
    const edit = applyRename(newText, taskId, options.title);
    newText = edit.newText;
    changed = changed || edit.changed;
  }

  if (options.clearBody) {
    const edit = applySetTaskBody(newText, taskId, null);
    newText = edit.newText;
    changed = changed || edit.changed;
  } else if (options.bodyMarkdown !== undefined) {
    const edit = applySetTaskBody(newText, taskId, options.bodyMarkdown);
    newText = edit.newText;
    changed = changed || edit.changed;
  }

  if (!changed) return { taskId, etag };
  await writeFileAtomic(absolutePath, newText);
  return { taskId, etag: sha256Hex(newText) };
}

export interface PlanUpdateOptions {
  planId: string;
  title?: string;
  bodyMarkdown?: string;
  clearBody?: boolean;
  ifMatch?: string;
}

/**
 * Update a plan title and/or plan-level body blockquote.
 */
export async function planUpdate(
  config: LongTermPlanConfig,
  options: PlanUpdateOptions
): Promise<{ etag: string }> {
  if (options.bodyMarkdown !== undefined && options.clearBody) {
    throw new Error('bodyMarkdown cannot be combined with clearBody');
  }
  if (options.title === undefined && options.bodyMarkdown === undefined && !options.clearBody) {
    throw new Error('At least one of title, bodyMarkdown, or clearBody is required');
  }

  const { absolutePath, text, etag } = await readPlanFile(config, options.planId);
  requireIfMatch(etag, options.ifMatch);

  let newText = text;
  let changed = false;

  if (options.title !== undefined) {
    const edit = applySetPlanTitle(newText, options.title);
    newText = edit.newText;
    changed = changed || edit.changed;
  }

  if (options.clearBody) {
    const edit = applySetPlanBody(newText, null);
    newText = edit.newText;
    changed = changed || edit.changed;
  } else if (options.bodyMarkdown !== undefined) {
    const edit = applySetPlanBody(newText, options.bodyMarkdown);
    newText = edit.newText;
    changed = changed || edit.changed;
  }

  if (!changed) return { etag };
  await writeFileAtomic(absolutePath, newText);
  return { etag: sha256Hex(newText) };
}

export interface TaskDeleteOptions {
  planId: string;
  taskId: string;
  ifMatch?: string;
}

/**
 * Delete a task (and its indented block) from a plan document.
 */
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
  planId: string;
  query: string;
  status?: TaskStatus;
  limit?: number;
}

/**
 * Search tasks by substring match on title (case-insensitive).
 */
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

  const limit = Math.max(1, Math.min(500, options.limit ?? 50));

  const hits: {
    planId: string;
    taskId: string;
    title: string;
    status: TaskStatus;
    sectionPath: string[];
  }[] = [];

  const { text } = await readPlanFile(config, options.planId);
  const parsed = parsePlanMarkdown(text);
  if (!parsed.ok || !parsed.plan) return [];
  for (const task of parsed.plan.tasksById.values()) {
    if (hits.length >= limit) return hits;
    if (options.status && task.status !== options.status) continue;
    if (!task.title.toLowerCase().includes(query)) continue;
    hits.push({
      planId: options.planId,
      taskId: task.id,
      title: task.title,
      status: task.status,
      sectionPath: task.sectionPath,
    });
  }

  return hits;
}

/**
 * Validate a plan document and return diagnostics with 1-based line numbers.
 *
 * The underlying validator uses 0-based indices; we convert to 1-based to match
 * editor UX expectations.
 */
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

/**
 * Repair a plan document and return a summary of what changed.
 *
 * If `dryRun` is true, no file is written, but the resulting etag still reflects
 * what the content *would* be after repair.
 */
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
