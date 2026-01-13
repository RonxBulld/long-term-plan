import { randomUUID } from 'node:crypto';
import { LONG_TERM_PLAN_FORMAT_HEADER } from './constants.js';
import { validatePlanMarkdown } from './validate.js';
const TASK_LINE_MISSING_ID_RE = /^(\s*-\s+\[([ *√])\]\s+.*?)(\s*)$/;
const TASK_ID_TRAILER_RE = /<!--\s*long-term-plan:id=([A-Za-z0-9_-]+)\s*-->\s*$/;
function detectEol(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}
function splitLines(text) {
    const eol = detectEol(text);
    const endsWithNewline = text.endsWith('\n');
    let lines = text.split(/\r?\n/);
    if (endsWithNewline && lines.length > 0 && lines[lines.length - 1] === '') {
        lines = lines.slice(0, -1);
    }
    return { lines, eol, endsWithNewline };
}
function joinLines(lines, eol, endsWithNewline) {
    const text = lines.join(eol);
    return endsWithNewline ? `${text}${eol}` : text;
}
function addFormatHeader(lines) {
    const hasHeader = lines
        .slice(0, Math.min(lines.length, 30))
        .some((l) => l.includes(LONG_TERM_PLAN_FORMAT_HEADER));
    if (hasHeader)
        return false;
    lines.unshift(LONG_TERM_PLAN_FORMAT_HEADER, '');
    return true;
}
function addMissingIds(lines) {
    let added = 0;
    let inFence = false;
    // We treat triple-backtick fences as a toggle and skip all lines inside.
    // This reduces the risk of mutating example snippets that look like tasks.
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const trimmed = line.trimStart();
        if (trimmed.startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        if (!line.match(TASK_LINE_MISSING_ID_RE))
            continue;
        if (line.match(TASK_ID_TRAILER_RE))
            continue;
        const id = `t_${randomUUID().replaceAll('-', '')}`;
        lines[index] = `${line} <!-- long-term-plan:id=${id} -->`;
        added += 1;
    }
    return added;
}
/**
 * Apply one or more repair actions to a plan document.
 *
 * The returned `applied` field is a structured summary of what changed, so
 * callers can present a precise report (and avoid guessing).
 */
export function repairPlanMarkdown(text, actions) {
    const { lines, eol, endsWithNewline } = splitLines(text);
    const applied = { addFormatHeader: false, addMissingIds: 0 };
    for (const action of actions) {
        if (action === 'addFormatHeader') {
            applied.addFormatHeader = addFormatHeader(lines) || applied.addFormatHeader;
            continue;
        }
        if (action === 'addMissingIds') {
            applied.addMissingIds += addMissingIds(lines);
            continue;
        }
        throw new Error(`Unknown repair action: ${action}`);
    }
    const newText = joinLines(lines, eol, true);
    const validation = validatePlanMarkdown(newText);
    if (validation.errors.length > 0) {
        const first = validation.errors[0];
        throw new Error(`Repair failed: ${first?.code ?? 'ERROR'} ${first?.message ?? ''}`);
    }
    return { newText, applied };
}
//# sourceMappingURL=repair.js.map