import { randomUUID } from 'node:crypto';
import type { ParsedPlan, TaskNode, TaskStatus } from './model.js';
import { parsePlanMarkdown, parseTaskLineStrict } from './parse.js';
import { statusToSymbol } from './status.js';
import { validatePlanMarkdown } from './validate.js';
import {
  LONG_TERM_PLAN_FORMAT_HEADER,
  LONG_TERM_PLAN_TASK_ID_KEY,
} from './constants.js';

export interface EditResult {
  newText: string;
  changed: boolean;
}

function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(text: string): { lines: string[]; eol: '\n' | '\r\n'; endsWithNewline: boolean } {
  const eol = detectEol(text);
  const endsWithNewline = text.endsWith('\n');
  let lines = text.split(/\r?\n/);
  if (endsWithNewline && lines.length > 0 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }
  return { lines, eol, endsWithNewline };
}

function joinLines(lines: string[], eol: '\n' | '\r\n', endsWithNewline: boolean): string {
  const text = lines.join(eol);
  return endsWithNewline ? `${text}${eol}` : text;
}

function sanitizeTitle(title: string): string {
  const normalized = title.replace(/\r?\n/g, ' ').trim();
  if (!normalized) throw new Error('Task title must be non-empty');
  if (normalized.includes('<!--') || normalized.includes('-->')) {
    throw new Error('Task title must not include HTML comment markers ("<!--" or "-->")');
  }
  return normalized;
}

function requireParsedPlan(text: string): ParsedPlan {
  const parsed = parsePlanMarkdown(text);
  if (!parsed.ok || !parsed.plan) {
    const message =
      parsed.errors.length > 0
        ? parsed.errors.map((d) => `${d.code}${d.line !== undefined ? `@${d.line + 1}` : ''}: ${d.message}`).join('\n')
        : 'Failed to parse plan';
    throw new Error(message);
  }
  return parsed.plan;
}

function findTask(plan: ParsedPlan, taskId: string): TaskNode {
  const task = plan.tasksById.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function updateLineStatus(line: string, status: TaskStatus): string {
  const symbol = statusToSymbol(status);
  const updated = line.replace(/^(\s*-\s+\[)[ *√](\]\s+)/, `$1${symbol}$2`);
  if (updated === line) throw new Error('Failed to update status (task line not in expected format)');
  return updated;
}

function updateLineTitle(line: string, title: string): string {
  const safeTitle = sanitizeTitle(title);
  const task = parseTaskLineStrict(line);
  if (!task) throw new Error('Failed to rename (task line not in expected format)');

  const prefixMatch = line.match(/^(\s*-\s+\[[ *√]\]\s+)/);
  const suffixMatch = line.match(
    /(\s+<!--\s*long-term-plan:id=[A-Za-z0-9_-]+\s*-->\s*)$/
  );
  if (!prefixMatch || !suffixMatch) throw new Error('Failed to rename (could not locate title region)');

  return `${prefixMatch[1]}${safeTitle}${suffixMatch[1]}`;
}

function ensureFormatHeader(lines: string[]): void {
  const hasHeader = lines
    .slice(0, Math.min(lines.length, 30))
    .some((l) => l.includes(LONG_TERM_PLAN_FORMAT_HEADER));
  if (hasHeader) return;
  lines.unshift(LONG_TERM_PLAN_FORMAT_HEADER, '');
}

function ensureSectionAtEof(lines: string[], sectionPath: string[]): number {
  if (sectionPath.length === 0) return lines.length;
  ensureFormatHeader(lines);
  if (lines.length > 0 && lines[lines.length - 1]?.trim() !== '') {
    lines.push('');
  }

  for (let index = 0; index < sectionPath.length; index += 1) {
    const title = sectionPath[index] ?? '';
    const level = 2 + index;
    const hashes = '#'.repeat(Math.min(6, level));
    lines.push(`${hashes} ${title}`);
  }
  lines.push('');
  return lines.length;
}

function createTaskLine(indent: number, status: TaskStatus, title: string, taskId: string): string {
  const safeTitle = sanitizeTitle(title);
  const prefix = `${' '.repeat(indent)}- [${statusToSymbol(status)}] `;
  return `${prefix}${safeTitle} <!-- ${LONG_TERM_PLAN_TASK_ID_KEY}=${taskId} -->`;
}

function buildSectionIndex(plan: ParsedPlan): Map<string, { startLine: number; endLine: number }> {
  const map = new Map<string, { startLine: number; endLine: number }>();
  for (const heading of plan.headings) {
    const key = heading.path.join(' / ');
    map.set(key, { startLine: heading.startLine, endLine: heading.endLine });
  }
  return map;
}

export function applySetStatus(text: string, taskId: string, status: TaskStatus): EditResult {
  const plan = requireParsedPlan(text);
  const task = findTask(plan, taskId);

  const { lines, eol, endsWithNewline } = splitLines(text);
  const lineIndex = task.line;
  const existing = lines[lineIndex];
  if (existing === undefined) throw new Error(`Invalid task line index: ${lineIndex}`);
  lines[lineIndex] = updateLineStatus(existing, status);

  const newText = joinLines(lines, eol, endsWithNewline);
  const validation = validatePlanMarkdown(newText);
  if (validation.errors.length > 0) {
    throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
  }
  return { newText, changed: newText !== text };
}

export function applyRename(text: string, taskId: string, title: string): EditResult {
  const plan = requireParsedPlan(text);
  const task = findTask(plan, taskId);

  const { lines, eol, endsWithNewline } = splitLines(text);
  const lineIndex = task.line;
  const existing = lines[lineIndex];
  if (existing === undefined) throw new Error(`Invalid task line index: ${lineIndex}`);
  lines[lineIndex] = updateLineTitle(existing, title);

  const newText = joinLines(lines, eol, endsWithNewline);
  const validation = validatePlanMarkdown(newText);
  if (validation.errors.length > 0) {
    throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
  }
  return { newText, changed: newText !== text };
}

export function applyDelete(text: string, taskId: string): EditResult {
  const plan = requireParsedPlan(text);
  const task = findTask(plan, taskId);

  const { lines, eol, endsWithNewline } = splitLines(text);
  const start = task.line;
  const end = task.blockEndLine;
  if (start < 0 || end < start || end >= lines.length) {
    throw new Error(`Invalid task block range: ${start}-${end}`);
  }

  lines.splice(start, end - start + 1);

  const newText = joinLines(lines, eol, endsWithNewline);
  const validation = validatePlanMarkdown(newText);
  if (validation.errors.length > 0) {
    throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
  }
  return { newText, changed: newText !== text };
}

export interface AddTaskOptions {
  title: string;
  status: TaskStatus;
  sectionPath?: string[];
  parentTaskId?: string;
}

export function applyAddTask(text: string, options: AddTaskOptions): { taskId: string; newText: string } {
  const { lines, eol, endsWithNewline } = splitLines(text);
  const originalPlan = parsePlanMarkdown(text);

  if (!originalPlan.ok || !originalPlan.plan) {
    // Allow creating into a brand new (or broken) doc only if it can be repaired by adding header + appending.
    // This keeps "success implies parseable" without making risky in-place edits.
    const validation = validatePlanMarkdown(text);
    if (validation.errors.length > 0) {
      // We'll only proceed if the only error is missing header or missing tasks; otherwise refuse.
      const nonHeaderErrors = validation.errors.filter((d) => d.code !== 'MISSING_FORMAT_HEADER');
      if (nonHeaderErrors.length > 0) {
        throw new Error(`Refusing to add task: document has validation errors (e.g. ${nonHeaderErrors[0]?.code})`);
      }
    }
    ensureFormatHeader(lines);
  }

  const plan = originalPlan.plan ?? requireParsedPlan(joinLines(lines, eol, endsWithNewline));
  const sectionIndex = buildSectionIndex(plan);

  const taskId = `t_${randomUUID().replaceAll('-', '')}`;
  if (plan.tasksById.has(taskId)) {
    throw new Error('Generated duplicate task id (unexpected)');
  }

  let insertAt = lines.length;
  let indent = 0;

  if (options.parentTaskId) {
    const parent = findTask(plan, options.parentTaskId);
    indent = parent.indent + 2;
    insertAt = parent.blockEndLine + 1;
  } else if (options.sectionPath && options.sectionPath.length > 0) {
    const key = options.sectionPath.join(' / ');
    const section = sectionIndex.get(key);
    if (!section) {
      insertAt = ensureSectionAtEof(lines, options.sectionPath);
    } else {
      insertAt = section.endLine + 1;
    }
  }

  const taskLine = createTaskLine(indent, options.status, options.title, taskId);
  lines.splice(insertAt, 0, taskLine);

  const newText = joinLines(lines, eol, true);
  const validation = validatePlanMarkdown(newText);
  if (validation.errors.length > 0) {
    throw new Error(`Add produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
  }

  return { taskId, newText };
}
