import { randomUUID } from 'node:crypto';
import { parsePlanMarkdown, parseTaskLineStrict } from './parse.js';
import { statusToSymbol } from './status.js';
import { validatePlanMarkdown } from './validate.js';
import { LONG_TERM_PLAN_FORMAT_HEADER, LONG_TERM_PLAN_TASK_ID_KEY, } from './constants.js';
/**
 * Detect whether the document uses CRLF or LF newlines.
 */
function detectEol(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}
/**
 * Split a document into lines while preserving its newline style.
 *
 * We keep track of whether the original text ended with a newline so we can
 * round-trip documents without unintended formatting changes.
 */
function splitLines(text) {
    const eol = detectEol(text);
    const endsWithNewline = text.endsWith('\n');
    let lines = text.split(/\r?\n/);
    if (endsWithNewline && lines.length > 0 && lines[lines.length - 1] === '') {
        lines = lines.slice(0, -1);
    }
    return { lines, eol, endsWithNewline };
}
/**
 * Join lines back into a string, optionally restoring a trailing newline.
 */
function joinLines(lines, eol, endsWithNewline) {
    const text = lines.join(eol);
    return endsWithNewline ? `${text}${eol}` : text;
}
/**
 * Normalize and validate a task title.
 *
 * Titles must not contain HTML comment delimiters because task ids are stored
 * in HTML comments at the end of the line.
 */
function sanitizeTitle(title) {
    const normalized = title.replace(/\r?\n/g, ' ').trim();
    if (!normalized)
        throw new Error('Task title must be non-empty');
    if (normalized.includes('<!--') || normalized.includes('-->')) {
        throw new Error('Task title must not include HTML comment markers ("<!--" or "-->")');
    }
    return normalized;
}
function sanitizePlanTitle(title) {
    const normalized = title.replace(/\r?\n/g, ' ').trim();
    if (!normalized)
        throw new Error('Plan title must be non-empty');
    return normalized;
}
function encodeBlockquoteBody(bodyMarkdown, indent) {
    const normalized = bodyMarkdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const lines = normalized.split('\n');
    const prefix = `${' '.repeat(indent)}>`;
    return lines.map((line) => (line.length === 0 ? prefix : `${prefix} ${line}`));
}
/**
 * Parse a plan and throw a detailed error on failure.
 *
 * This helper is used for edit operations where "cannot parse" should become a
 * meaningful message rather than silent failure.
 */
function requireParsedPlan(text) {
    const parsed = parsePlanMarkdown(text);
    if (!parsed.ok || !parsed.plan) {
        const message = parsed.errors.length > 0
            ? parsed.errors.map((d) => `${d.code}${d.line !== undefined ? `@${d.line + 1}` : ''}: ${d.message}`).join('\n')
            : 'Failed to parse plan';
        throw new Error(message);
    }
    return parsed.plan;
}
/**
 * Find a task by id (or throw).
 */
function findTask(plan, taskId) {
    const task = plan.tasksById.get(taskId);
    if (!task)
        throw new Error(`Task not found: ${taskId}`);
    return task;
}
function findFirstH1Line(lines) {
    const line = lines.findIndex((l) => l.match(/^#\s+/));
    if (line === -1)
        throw new Error('Missing plan title heading (# ...)');
    return line;
}
/**
 * Update the `[ ]` / `[*]` / `[√]` symbol portion of a task line.
 */
function updateLineStatus(line, status) {
    const symbol = statusToSymbol(status);
    const updated = line.replace(/^(\s*-\s+\[)[ *√](\]\s+)/, `$1${symbol}$2`);
    if (updated === line)
        throw new Error('Failed to update status (task line not in expected format)');
    return updated;
}
/**
 * Update the title portion of a strict task line while preserving the id trailer.
 */
function updateLineTitle(line, title) {
    const safeTitle = sanitizeTitle(title);
    const task = parseTaskLineStrict(line);
    if (!task)
        throw new Error('Failed to rename (task line not in expected format)');
    const prefixMatch = line.match(/^(\s*-\s+\[[ *√]\]\s+)/);
    const suffixMatch = line.match(/(\s+<!--\s*long-term-plan:id=[A-Za-z0-9_-]+\s*-->\s*)$/);
    if (!prefixMatch || !suffixMatch)
        throw new Error('Failed to rename (could not locate title region)');
    return `${prefixMatch[1]}${safeTitle}${suffixMatch[1]}`;
}
/**
 * Ensure the required format header exists near the top of the document.
 */
function ensureFormatHeader(lines) {
    const hasHeader = lines
        .slice(0, Math.min(lines.length, 30))
        .some((l) => l.includes(LONG_TERM_PLAN_FORMAT_HEADER));
    if (hasHeader)
        return;
    lines.unshift(LONG_TERM_PLAN_FORMAT_HEADER, '');
}
/**
 * Ensure a heading path exists at the end of the file and return its end index.
 *
 * Section creation is intentionally append-only to avoid reshuffling existing
 * content in documents that may be partially invalid.
 */
function ensureSectionAtEof(lines, sectionPath) {
    if (sectionPath.length === 0)
        return lines.length;
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
/**
 * Build a strict task line at a given indentation level.
 */
function createTaskLine(indent, status, title, taskId) {
    const safeTitle = sanitizeTitle(title);
    const prefix = `${' '.repeat(indent)}- [${statusToSymbol(status)}] `;
    return `${prefix}${safeTitle} <!-- ${LONG_TERM_PLAN_TASK_ID_KEY}=${taskId} -->`;
}
/**
 * Create an index mapping each heading path to its (startLine, endLine).
 *
 * This is used to insert tasks into an existing section with minimal changes.
 */
function buildSectionIndex(plan) {
    const map = new Map();
    for (const heading of plan.headings) {
        const key = heading.path.join(' / ');
        map.set(key, { startLine: heading.startLine, endLine: heading.endLine });
    }
    return map;
}
/**
 * Update a task status in-place.
 *
 * This is designed to produce a minimal diff: only the status symbol changes.
 */
export function applySetStatus(text, taskId, status) {
    const plan = requireParsedPlan(text);
    const task = findTask(plan, taskId);
    const { lines, eol, endsWithNewline } = splitLines(text);
    const lineIndex = task.line;
    const existing = lines[lineIndex];
    if (existing === undefined)
        throw new Error(`Invalid task line index: ${lineIndex}`);
    lines[lineIndex] = updateLineStatus(existing, status);
    const newText = joinLines(lines, eol, endsWithNewline);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }
    return { newText, changed: newText !== text };
}
/**
 * Rename a task in-place.
 *
 * Only the title region changes; the task id trailer is preserved.
 */
export function applyRename(text, taskId, title) {
    const plan = requireParsedPlan(text);
    const task = findTask(plan, taskId);
    const { lines, eol, endsWithNewline } = splitLines(text);
    const lineIndex = task.line;
    const existing = lines[lineIndex];
    if (existing === undefined)
        throw new Error(`Invalid task line index: ${lineIndex}`);
    lines[lineIndex] = updateLineTitle(existing, title);
    const newText = joinLines(lines, eol, endsWithNewline);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }
    return { newText, changed: newText !== text };
}
/**
 * Delete a task and its entire indented block (children, grandchildren, ...).
 */
export function applyDelete(text, taskId) {
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
/**
 * Add a new task to the document.
 *
 * Insertion rules (highest priority first):
 * - If `beforeTaskId` is provided, insert as a sibling immediately before that task.
 * - If `parentTaskId` is provided, insert as the last child of that task block.
 * - Else if `sectionPath` is provided, insert under that heading (creating it at EOF if missing).
 * - Else insert at end-of-file.
 *
 * The function always returns text ending with a newline to keep documents tidy.
 */
export function applyAddTask(text, options) {
    const { lines, eol, endsWithNewline } = splitLines(text);
    const originalPlan = parsePlanMarkdown(text);
    if (options.beforeTaskId &&
        (options.parentTaskId || (options.sectionPath && options.sectionPath.length > 0))) {
        throw new Error('beforeTaskId cannot be combined with parentTaskId or sectionPath');
    }
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
    if (options.beforeTaskId) {
        const anchor = findTask(plan, options.beforeTaskId);
        indent = anchor.indent;
        insertAt = anchor.line;
    }
    else if (options.parentTaskId) {
        const parent = findTask(plan, options.parentTaskId);
        indent = parent.indent + 2;
        insertAt = parent.blockEndLine + 1;
    }
    else if (options.sectionPath && options.sectionPath.length > 0) {
        const key = options.sectionPath.join(' / ');
        const section = sectionIndex.get(key);
        if (!section) {
            insertAt = ensureSectionAtEof(lines, options.sectionPath);
        }
        else {
            insertAt = section.endLine + 1;
        }
    }
    const taskLine = createTaskLine(indent, options.status, options.title, taskId);
    const insertLines = [taskLine];
    if (options.bodyMarkdown !== undefined) {
        insertLines.push(...encodeBlockquoteBody(options.bodyMarkdown, indent + 2));
    }
    lines.splice(insertAt, 0, ...insertLines);
    const newText = joinLines(lines, eol, true);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        throw new Error(`Add produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }
    return { taskId, newText };
}
/**
 * Replace (or clear) the structured blockquote body for a task.
 *
 * The body is stored as an indented blockquote run immediately after the task line.
 * This edit only touches the body lines (minimal diff).
 */
export function applySetTaskBody(text, taskId, bodyMarkdown) {
    const plan = requireParsedPlan(text);
    const task = findTask(plan, taskId);
    const { lines, eol, endsWithNewline } = splitLines(text);
    const existing = task.bodyRange;
    if (bodyMarkdown === null) {
        if (!existing)
            return { newText: text, changed: false };
        lines.splice(existing.startLine, existing.endLine - existing.startLine + 1);
    }
    else {
        const encoded = encodeBlockquoteBody(bodyMarkdown, task.indent + 2);
        if (existing) {
            lines.splice(existing.startLine, existing.endLine - existing.startLine + 1, ...encoded);
        }
        else {
            lines.splice(task.line + 1, 0, ...encoded);
        }
    }
    const newText = joinLines(lines, eol, endsWithNewline);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }
    return { newText, changed: newText !== text };
}
/**
 * Replace (or clear) the plan-level body blockquote under the first H1.
 */
export function applySetPlanBody(text, bodyMarkdown) {
    const plan = requireParsedPlan(text);
    const { lines, eol, endsWithNewline } = splitLines(text);
    const h1Line = findFirstH1Line(lines);
    const existing = plan.bodyRange;
    if (bodyMarkdown === null) {
        if (!existing)
            return { newText: text, changed: false };
        lines.splice(existing.startLine, existing.endLine - existing.startLine + 1);
    }
    else {
        const encoded = encodeBlockquoteBody(bodyMarkdown, 0);
        if (existing) {
            lines.splice(existing.startLine, existing.endLine - existing.startLine + 1, ...encoded);
        }
        else {
            let insertAt = h1Line + 1;
            while (insertAt < lines.length && lines[insertAt]?.trim() === '')
                insertAt += 1;
            lines.splice(insertAt, 0, ...encoded);
        }
    }
    const newText = joinLines(lines, eol, endsWithNewline);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }
    return { newText, changed: newText !== text };
}
/**
 * Update the plan title (the first H1 line) in-place.
 *
 * Only the single H1 line changes (minimal diff).
 */
export function applySetPlanTitle(text, title) {
    const safeTitle = sanitizePlanTitle(title);
    const { lines, eol, endsWithNewline } = splitLines(text);
    const h1Line = findFirstH1Line(lines);
    const existing = lines[h1Line];
    if (existing === undefined)
        throw new Error(`Invalid title line index: ${h1Line}`);
    if (!existing.match(/^#\s+/))
        throw new Error('Failed to update plan title (missing H1)');
    lines[h1Line] = `# ${safeTitle}`;
    const newText = joinLines(lines, eol, endsWithNewline);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        throw new Error(`Edit produced invalid document: ${validation.errors[0]?.message ?? 'unknown error'}`);
    }
    return { newText, changed: newText !== text };
}
//# sourceMappingURL=edit.js.map