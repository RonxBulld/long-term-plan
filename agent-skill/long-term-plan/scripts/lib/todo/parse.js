import { LONG_TERM_PLAN_FORMAT_HEADER } from './constants.js';
import { errorDiagnostic, warningDiagnostic } from './diagnostics.js';
import { symbolToStatus } from './status.js';
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TASK_LINE_STRICT_RE = /^(\s*)-\s+\[([ *√])\]\s+(.*?)(\s+<!--\s*long-term-plan:id=([A-Za-z0-9_-]+)\s*-->)\s*$/;
/**
 * Parse a strict task line.
 *
 * Strict format example:
 * `- [ ] Title <!-- long-term-plan:id=t_abc123 -->`
 *
 * Returns `undefined` if the line is not a valid task line.
 */
export function parseTaskLineStrict(line) {
    const match = line.match(TASK_LINE_STRICT_RE);
    if (!match)
        return undefined;
    const indent = match[1]?.length ?? 0;
    const symbol = match[2];
    const titleRaw = match[3] ?? '';
    const id = match[5] ?? '';
    const title = titleRaw.trim();
    if (!title)
        return undefined;
    if (!id)
        return undefined;
    if (title.includes('<!--') || title.includes('-->'))
        return undefined;
    return { indent, symbol, title, id };
}
function isBlankLine(line) {
    return line.trim().length === 0;
}
function lineIndent(line) {
    let count = 0;
    while (count < line.length && line[count] === ' ')
        count += 1;
    return count;
}
/**
 * True if the line is a blockquote line (after trimming leading spaces).
 *
 * We use blockquotes as the on-disk encoding for multi-line plan/task bodies so
 * body content can freely include `- [ ]` without being mistaken for a task line.
 */
function isBlockquoteLine(line) {
    return line.trimStart().startsWith('>');
}
/**
 * Decode a single blockquote line by stripping:
 * - leading spaces
 * - a single leading `>`
 * - an optional single space following the `>`
 */
function decodeBlockquoteLine(line) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('>'))
        return '';
    const rest = trimmed.slice(1);
    return rest.startsWith(' ') ? rest.slice(1) : rest;
}
/**
 * Parse a plan-level blockquote body under the first H1.
 *
 * Body detection is intentionally strict and conservative:
 * - we skip blank lines after the H1
 * - we only treat the first contiguous blockquote run as the plan body
 */
function parsePlanBody(lines, h1Line) {
    if (h1Line === undefined)
        return { hasBody: false };
    let index = h1Line + 1;
    while (index < lines.length && isBlankLine(lines[index] ?? ''))
        index += 1;
    if (index >= lines.length)
        return { hasBody: false };
    const first = lines[index] ?? '';
    if (!isBlockquoteLine(first))
        return { hasBody: false };
    const startLine = index;
    const decoded = [];
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (!isBlockquoteLine(line))
            break;
        decoded.push(decodeBlockquoteLine(line));
        index += 1;
    }
    return {
        hasBody: true,
        bodyMarkdown: decoded.join('\n'),
        bodyRange: { startLine, endLine: index - 1 },
    };
}
/**
 * Parse a task-level blockquote body immediately after a strict task line.
 *
 * The body is a contiguous run where each line:
 * - has indent >= `taskIndent + 2`
 * - is a blockquote line (`>` after leading spaces)
 */
function parseTaskBody(lines, taskLine, taskIndent) {
    let index = taskLine + 1;
    if (index >= lines.length)
        return { hasBody: false, endLineExclusive: taskLine + 1 };
    const decoded = [];
    const startLine = index;
    while (index < lines.length) {
        const line = lines[index] ?? '';
        if (lineIndent(line) < taskIndent + 2)
            break;
        if (!isBlockquoteLine(line))
            break;
        decoded.push(decodeBlockquoteLine(line));
        index += 1;
    }
    if (decoded.length === 0)
        return { hasBody: false, endLineExclusive: taskLine + 1 };
    return {
        hasBody: true,
        bodyMarkdown: decoded.join('\n'),
        bodyRange: { startLine, endLine: index - 1 },
        endLineExclusive: index,
    };
}
/**
 * Close tasks when we hit a block boundary (indentation returns to the same or shallower level).
 *
 * This computes `blockEndLine` so delete/edit operations can safely target the full indented block.
 */
function closeTasksAtBoundary(openTasks, boundaryLine, indent) {
    while (openTasks.length > 0) {
        const top = openTasks[openTasks.length - 1];
        if (!top)
            break;
        if (indent > top.task.indent)
            break;
        top.task.blockEndLine = boundaryLine - 1;
        openTasks.pop();
    }
}
/**
 * Close all open tasks at a boundary (used when entering headings or end-of-file).
 */
function closeAllTasksAtBoundary(openTasks, boundaryLine) {
    while (openTasks.length > 0) {
        const top = openTasks.pop();
        if (!top)
            continue;
        top.task.blockEndLine = boundaryLine - 1;
    }
}
/**
 * Close headings when we see a heading at the same or higher level.
 *
 * This computes `endLine` for each heading so sections can be addressed by range.
 */
function closeHeadingsAtBoundary(headingStack, headingIndexStack, headings, boundaryLine, level) {
    while (headingStack.length > 0) {
        const top = headingStack[headingStack.length - 1];
        if (!top)
            break;
        if (top.level < level)
            break;
        const headingIndex = headingIndexStack.pop();
        headingStack.pop();
        if (headingIndex === undefined)
            continue;
        headings[headingIndex] = {
            ...headings[headingIndex],
            endLine: boundaryLine - 1,
        };
    }
}
function buildHeadingPath(frames, includeH1) {
    const filtered = includeH1 ? frames : frames.filter((frame) => frame.level >= 2);
    return filtered.map((frame) => frame.text);
}
/**
 * Parse a plan markdown document into headings and a task tree.
 *
 * Behavior highlights:
 * - Requires a format header somewhere near the top (first ~30 lines).
 * - Uses indentation to infer parent/child relationships between tasks.
 * - Computes `blockEndLine` for each task so edit operations can delete blocks.
 */
export function parsePlanMarkdown(text) {
    const errors = [];
    const warnings = [];
    const lines = text.split(/\r?\n/);
    if (text.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    const headerLine = lines
        .slice(0, Math.min(lines.length, 30))
        .findIndex((line) => line.includes(LONG_TERM_PLAN_FORMAT_HEADER));
    if (headerLine === -1) {
        errors.push(errorDiagnostic('MISSING_FORMAT_HEADER', `Missing required header: ${LONG_TERM_PLAN_FORMAT_HEADER}`));
    }
    const headings = [];
    const headingStack = [];
    const headingIndexStack = [];
    const includeH1InSectionPath = false;
    const rootTasks = [];
    const tasksById = new Map();
    const openTasks = [];
    let planTitle = 'Untitled Plan';
    let firstH1Line;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        const headingMatch = line.match(HEADING_RE);
        if (headingMatch) {
            closeAllTasksAtBoundary(openTasks, lineIndex);
            const level = headingMatch[1]?.length ?? 1;
            const headingText = (headingMatch[2] ?? '').trim();
            if (level === 1 && headingText && firstH1Line === undefined) {
                planTitle = headingText;
                firstH1Line = lineIndex;
            }
            closeHeadingsAtBoundary(headingStack, headingIndexStack, headings, lineIndex, level);
            headingStack.push({ level, text: headingText, line: lineIndex });
            headings.push({
                level,
                text: headingText,
                line: lineIndex,
                path: buildHeadingPath(headingStack, includeH1InSectionPath),
                startLine: lineIndex,
                endLine: lines.length - 1,
            });
            headingIndexStack.push(headings.length - 1);
            continue;
        }
        const parsedTask = parseTaskLineStrict(line);
        if (parsedTask) {
            closeTasksAtBoundary(openTasks, lineIndex, parsedTask.indent);
            const sectionPath = buildHeadingPath(headingStack, includeH1InSectionPath);
            const status = symbolToStatus(parsedTask.symbol);
            const task = {
                id: parsedTask.id,
                title: parsedTask.title,
                status,
                hasBody: false,
                indent: parsedTask.indent,
                line: lineIndex,
                blockEndLine: lines.length - 1,
                sectionPath,
                children: [],
            };
            const body = parseTaskBody(lines, lineIndex, task.indent);
            if (body.hasBody) {
                task.hasBody = true;
                task.bodyMarkdown = body.bodyMarkdown;
                task.bodyRange = body.bodyRange;
                lineIndex = body.endLineExclusive - 1;
            }
            if (tasksById.has(task.id)) {
                errors.push(errorDiagnostic('DUPLICATE_TASK_ID', `Duplicate task id: ${task.id}`, task.line));
            }
            else {
                tasksById.set(task.id, task);
            }
            const parentFrame = openTasks[openTasks.length - 1];
            if (parentFrame) {
                task.parentId = parentFrame.task.id;
                parentFrame.task.children.push(task);
            }
            else {
                rootTasks.push(task);
            }
            openTasks.push({ task });
            continue;
        }
        if (!isBlankLine(line)) {
            const indent = lineIndent(line);
            if (openTasks.length > 0) {
                const top = openTasks[openTasks.length - 1];
                if (top && indent <= top.task.indent) {
                    closeTasksAtBoundary(openTasks, lineIndex, indent);
                }
            }
        }
    }
    closeAllTasksAtBoundary(openTasks, lines.length);
    closeHeadingsAtBoundary(headingStack, headingIndexStack, headings, lines.length, 1);
    if (headerLine !== -1 && tasksById.size === 0) {
        warnings.push(warningDiagnostic('NO_TASKS', 'No tasks found in document.'));
    }
    const planBody = parsePlanBody(lines, firstH1Line);
    const ok = errors.length === 0;
    return {
        ok,
        plan: ok
            ? {
                title: planTitle,
                hasBody: planBody.hasBody,
                bodyMarkdown: planBody.bodyMarkdown,
                bodyRange: planBody.bodyRange,
                headings,
                rootTasks,
                tasksById,
            }
            : undefined,
        errors,
        warnings,
    };
}
//# sourceMappingURL=parse.js.map