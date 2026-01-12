/**
 * Repair unit tests.
 *
 * The repair layer is intentionally conservative: it only performs explicit
 * actions requested by the caller, and it validates the final output.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { repairPlanMarkdown } from '../dist/todo/repair.js';
import { validatePlanMarkdown } from '../dist/todo/validate.js';

test('repairPlanMarkdown can add header and missing ids', () => {
  // Start from a document that is missing the required format header and ids.
  const before = ['# T', '', '- [ ] A', '- [*] B', ''].join('\n');
  const repaired = repairPlanMarkdown(before, ['addFormatHeader', 'addMissingIds']);
  assert.equal(repaired.applied.addFormatHeader, true);
  assert.equal(repaired.applied.addMissingIds, 2);

  // The repaired result must validate cleanly.
  const validation = validatePlanMarkdown(repaired.newText);
  assert.equal(validation.errors.length, 0);
  assert.match(repaired.newText, /<!-- long-term-plan:format=v1 -->/);
  assert.match(repaired.newText, /<!-- long-term-plan:id=t_/);
});
