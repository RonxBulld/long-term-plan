/**
 * Minimal-diff edit unit tests.
 *
 * We validate two key properties:
 * - edits only touch the intended part of the line (status symbol / title)
 * - the resulting document still passes validation
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRename, applySetStatus } from '../dist/todo/edit.js';
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
