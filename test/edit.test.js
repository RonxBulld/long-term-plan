/**
 * Minimal-diff edit unit tests.
 *
 * We validate two key properties:
 * - edits only touch the intended part of the line (status symbol / title)
 * - the resulting document still passes validation
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAddTask, applyRename, applySetStatus } from '../dist/todo/edit.js';
import { validatePlanMarkdown } from '../dist/todo/validate.js';

test('applySetStatus only changes the status symbol', () => {
  // Only the `[ ]` -> `[*]` portion should change.
  const before = ['<!-- long-term-plan:format=v1 -->', '', '- [ ] Hello <!-- long-term-plan:id=t_1 -->', ''].join('\n');
  const after = applySetStatus(before, 't_1', 'doing').newText;
  assert.equal(after, ['<!-- long-term-plan:format=v1 -->', '', '- [*] Hello <!-- long-term-plan:id=t_1 -->', ''].join('\n'));
});

test('applyRename preserves trailing id comment', () => {
  // The `<!-- long-term-plan:id=... -->` trailer must be preserved exactly.
  const before = ['<!-- long-term-plan:format=v1 -->', '', '- [ ] Old title <!-- long-term-plan:id=t_2 -->', ''].join('\n');
  const after = applyRename(before, 't_2', 'New title').newText;
  assert.equal(after, ['<!-- long-term-plan:format=v1 -->', '', '- [ ] New title <!-- long-term-plan:id=t_2 -->', ''].join('\n'));
});

test('edited text remains valid', () => {
  // Every edit operation is expected to round-trip through validation.
  const before = ['<!-- long-term-plan:format=v1 -->', '', '# T', '', '- [ ] A <!-- long-term-plan:id=t_3 -->', ''].join('\n');
  const after = applySetStatus(before, 't_3', 'done').newText;
  const validation = validatePlanMarkdown(after);
  assert.equal(validation.errors.length, 0);
});

test('applyAddTask can insert before beforeTaskId', () => {
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '- [ ] Parent <!-- long-term-plan:id=t_p -->',
    '  - [ ] Child A <!-- long-term-plan:id=t_ca -->',
    '  - [ ] Child B <!-- long-term-plan:id=t_cb -->',
    '',
  ].join('\n');

  const added = applyAddTask(before, {
    title: 'Inserted sibling',
    status: 'todo',
    beforeTaskId: 't_cb',
  });

  const lines = added.newText.trimEnd().split('\n');
  const insertIndex = lines.findIndex((line) => line.includes('Inserted sibling'));
  const anchorIndex = lines.findIndex((line) => line.includes('<!-- long-term-plan:id=t_cb -->'));

  assert.ok(insertIndex >= 0);
  assert.ok(anchorIndex >= 0);
  assert.equal(insertIndex + 1, anchorIndex);
  assert.match(
    lines[insertIndex],
    /^  - \[ \] Inserted sibling <!-- long-term-plan:id=t_[a-f0-9]{32} -->$/
  );
});

test('applyAddTask rejects beforeTaskId with other placement options', () => {
  const before = ['<!-- long-term-plan:format=v1 -->', '', '- [ ] A <!-- long-term-plan:id=t_1 -->', ''].join('\n');
  assert.throws(
    () =>
      applyAddTask(before, {
        title: 'X',
        status: 'todo',
        beforeTaskId: 't_1',
        sectionPath: ['Inbox'],
      }),
    /beforeTaskId cannot be combined/
  );
});
