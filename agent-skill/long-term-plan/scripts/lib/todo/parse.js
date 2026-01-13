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
    // When we encounter a task, we treat it as the start of a "block" which ends
    // when we see a line with indentation <= the task's indentation.
    function closeTasksAtBoundary(boundaryLine, indent) {
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
    function closeAllTasksAtBoundary(boundaryLine) {
        while (openTasks.length > 0) {
            const top = openTasks.pop();
            if (!top)
                continue;
            top.task.blockEndLine = boundaryLine - 1;
        }
    }
    // Similar to tasks, headings define a section range. We close headings when we
    // see a heading at the same or higher level.
    function closeHeadingsAtBoundary(boundaryLine, level) {
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
    let planTitle = 'Untitled Plan';
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        const headingMatch = line.match(HEADING_RE);
        if (headingMatch) {
            closeAllTasksAtBoundary(lineIndex);
            const level = headingMatch[1]?.length ?? 1;
            const headingText = (headingMatch[2] ?? '').trim();
            if (level === 1 && headingText) {
                planTitle = headingText;
            }
            closeHeadingsAtBoundary(lineIndex, level);
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
            closeTasksAtBoundary(lineIndex, parsedTask.indent);
            const sectionPath = buildHeadingPath(headingStack, includeH1InSectionPath);
            const status = symbolToStatus(parsedTask.symbol);
            const task = {
                id: parsedTask.id,
                title: parsedTask.title,
                status,
                indent: parsedTask.indent,
                line: lineIndex,
                blockEndLine: lines.length - 1,
                sectionPath,
                children: [],
            };
            if (tasksById.has(task.id)) {
                errors.push(errorDiagnostic('DUPLICATE_TASK_ID', `Duplicate task id: ${task.id}`, lineIndex));
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
                    closeTasksAtBoundary(lineIndex, indent);
                }
            }
        }
    }
    closeAllTasksAtBoundary(lines.length);
    closeHeadingsAtBoundary(lines.length, 1);
    if (headerLine !== -1 && tasksById.size === 0) {
        warnings.push(warningDiagnostic('NO_TASKS', 'No tasks found in document.'));
    }
    const ok = errors.length === 0;
    return {
        ok,
        plan: ok
            ? {
                title: planTitle,
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