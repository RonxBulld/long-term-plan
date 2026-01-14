/**
 * Edit helpers should preserve text "shape":
 * - newline style (LF vs CRLF)
 * - presence/absence of a trailing newline (except for `applyAddTask`, which
 *   intentionally normalizes to end with a newline)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRename, applySetPlanBody, applySetPlanTitle, applySetStatus, applySetTaskBody } from '../dist/todo/edit.js';

function assertNoBareLf(text) {
  // Ensure we only have CRLF newlines, not stray `\n` without a preceding `\r`.
  assert.equal(/(^|[^\r])\n/.test(text), false, 'expected no bare LF newlines');
}

test('edit helpers preserve CRLF newlines', () => {
  const beforeLines = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Task <!-- long-term-plan:id=t_a -->',
    '',
  ];
  const before = `${beforeLines.join('\r\n')}\r\n`;

  const status = applySetStatus(before, 't_a', 'doing').newText;
  assert.ok(status.includes('\r\n'));
  assertNoBareLf(status);

  const renamed = applyRename(before, 't_a', 'Task (renamed)').newText;
  assert.ok(renamed.includes('\r\n'));
  assertNoBareLf(renamed);

  const withTaskBody = applySetTaskBody(before, 't_a', 'Line 1\n\nLine 2').newText;
  assert.ok(withTaskBody.includes('\r\n'));
  assertNoBareLf(withTaskBody);

  const withPlanBody = applySetPlanBody(before, 'Plan intro').newText;
  assert.ok(withPlanBody.includes('\r\n'));
  assertNoBareLf(withPlanBody);
});

test('edit helpers preserve missing trailing newline', () => {
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] Task <!-- long-term-plan:id=t_a -->',
  ].join('\n'); // intentionally no trailing newline

  assert.equal(before.endsWith('\n'), false);

  const status = applySetStatus(before, 't_a', 'done').newText;
  assert.equal(status.endsWith('\n'), false);

  const renamed = applyRename(before, 't_a', 'Task (renamed)').newText;
  assert.equal(renamed.endsWith('\n'), false);

  const title = applySetPlanTitle(before, 'New title').newText;
  assert.equal(title.endsWith('\n'), false);

  const body = applySetTaskBody(before, 't_a', 'Body line').newText;
  assert.equal(body.endsWith('\n'), false);
});
