/**
 * Validator edge/corner-case tests.
 *
 * Goal: ensure each diagnostic branch stays covered and stable.
 *
 * Notes:
 * - The validator is the “contract enforcer” for hand-edited markdown: it must
 *   flag issues that would later prevent safe edits (ex: ids that APIs refuse).
 * - We intentionally keep some behaviors conservative (ex: id trailer regex)
 *   to avoid accidentally treating arbitrary comments as task ids.
 * - Several tests below lock in diagnostic precedence to prevent regressions
 *   where a more generic error would hide a more actionable one.
 *
 * These tests intentionally run against the compiled `dist/` output to match
 * the shipped CLI/server behavior.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePlanMarkdown } from '../dist/todo/validate.js';

function codes(diags) {
  return diags.map((d) => d.code);
}

test('validatePlanMarkdown: reports missing format header when absent', () => {
  const text = ['# Title', '', '- [ ] Task <!-- long-term-plan:id=t_a -->', ''].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('MISSING_FORMAT_HEADER'));
});

test('validatePlanMarkdown: header beyond first 30 lines is treated as missing', () => {
  // Both parser and validator only look for the header near the top of the file.
  const prefix = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const text = [
    prefix,
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Task <!-- long-term-plan:id=t_a -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('MISSING_FORMAT_HEADER'));
});

test('validatePlanMarkdown: reports invalid status symbols', () => {
  // Include one valid task to avoid NO_TASKS noise.
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [x] Bad symbol <!-- long-term-plan:id=t_bad -->',
    '- [ ] Good <!-- long-term-plan:id=t_good -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('INVALID_STATUS_SYMBOL'));
});

test('validatePlanMarkdown: reports missing task id trailers', () => {
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Missing id',
    '- [ ] Good <!-- long-term-plan:id=t_good -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('MISSING_TASK_ID'));
});

test('validatePlanMarkdown: reports malformed task lines when an id trailer exists', () => {
  // The id trailer exists, but the strict task format is invalid (empty title).
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] <!-- long-term-plan:id=t_bad -->',
    '- [ ] Good <!-- long-term-plan:id=t_good -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('MALFORMED_TASK_LINE'));
});

test('validatePlanMarkdown: reports duplicate task ids', () => {
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] A <!-- long-term-plan:id=t_dup -->',
    '- [ ] B <!-- long-term-plan:id=t_dup -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('DUPLICATE_TASK_ID'));
});

test('validatePlanMarkdown: reports invalid task ids', () => {
  // Invalid by runtime "safe id" rules: ids must start with [A-Za-z0-9].
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Bad id <!-- long-term-plan:id=_bad -->',
    '- [ ] Good <!-- long-term-plan:id=t_good -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('INVALID_TASK_ID'));
});

test('validatePlanMarkdown: reports invalid task ids (more variants)', () => {
  // Covers: invalid first char and length > 128.
  const tooLong = `t_${'a'.repeat(200)}`;
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Bad id <!-- long-term-plan:id=-bad -->',
    `- [ ] Too long <!-- long-term-plan:id=${tooLong} -->`,
    '- [ ] Good <!-- long-term-plan:id=t_good -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('INVALID_TASK_ID'));
});

test('validatePlanMarkdown: invalid task id beats malformed task line', () => {
  // Even when the strict task format is malformed, we still want to surface an
  // id that cannot be targeted by APIs.
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] <!-- long-term-plan:id=_bad -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.deepEqual(codes(result.errors), ['INVALID_TASK_ID']);
});

test('validatePlanMarkdown: id trailer with unsupported characters is treated as missing', () => {
  // The validator only recognizes id trailers that match `[A-Za-z0-9_-]+`.
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Looks like an id <!-- long-term-plan:id=t.bad -->',
    '- [ ] Good <!-- long-term-plan:id=t_good -->',
    '',
  ].join('\n');
  const result = validatePlanMarkdown(text);
  assert.ok(codes(result.errors).includes('MISSING_TASK_ID'));
});

test('validatePlanMarkdown: warns when a header is present but no tasks exist', () => {
  const text = ['<!-- long-term-plan:format=v1 -->', '', '# Title', '', '## Inbox', ''].join('\n');
  const result = validatePlanMarkdown(text);
  assert.deepEqual(result.errors, []);
  assert.ok(codes(result.warnings).includes('NO_TASKS'));
});
