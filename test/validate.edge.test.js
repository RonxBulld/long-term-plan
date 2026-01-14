/**
 * Validator edge/corner-case tests.
 *
 * Goal: ensure each diagnostic branch stays covered and stable.
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

test('validatePlanMarkdown: warns when a header is present but no tasks exist', () => {
  const text = ['<!-- long-term-plan:format=v1 -->', '', '# Title', '', '## Inbox', ''].join('\n');
  const result = validatePlanMarkdown(text);
  assert.deepEqual(result.errors, []);
  assert.ok(codes(result.warnings).includes('NO_TASKS'));
});
