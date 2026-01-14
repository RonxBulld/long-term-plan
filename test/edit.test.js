/**
 * Minimal-diff edit unit tests.
 *
 * We validate two key properties:
 * - edits only touch the intended part of the line (status symbol / title)
 * - the resulting document still passes validation
 *
 * In addition, this suite covers body encoding rules used by the v1 format:
 * - task bodies are stored as an indented blockquote run under the task line
 * - plan bodies are stored as a top-level blockquote run under the first H1
 *
 * These tests intentionally use exact string comparisons so we can detect
 * accidental formatting churn (e.g. extra whitespace or reflow).
 *
 * Note: these unit tests run against `dist/` so failures represent the shipped
 * CLI/server behavior rather than TypeScript source quirks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAddTask, applyRename, applySetPlanBody, applySetStatus, applySetTaskBody } from '../dist/todo/edit.js';
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
  // Placement: insert a sibling without rewriting unrelated lines.
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

test('applySetTaskBody encodes body as an indented blockquote run', () => {
  // Encoding: body lines are stored as `> ...` with strict +2 indentation.
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# T',
    '',
    '- [ ] A <!-- long-term-plan:id=t_1 -->',
    '',
  ].join('\n');

  const body = ['- [ ] checkbox', '', '```ts', 'const x = 1', '```'].join('\n');
  const after = applySetTaskBody(before, 't_1', body).newText;

  assert.equal(
    after,
    [
      '<!-- long-term-plan:format=v1 -->',
      '',
      '# T',
      '',
      '- [ ] A <!-- long-term-plan:id=t_1 -->',
      '  > - [ ] checkbox',
      '  >',
      '  > ```ts',
      '  > const x = 1',
      '  > ```',
      '',
    ].join('\n')
  );
});

test('applySetTaskBody can clear an existing structured body', () => {
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# T',
    '',
    '- [ ] A <!-- long-term-plan:id=t_1 -->',
    '  > Note line 1',
    '  >',
    '  > Note line 2',
    '',
  ].join('\n');

  const cleared = applySetTaskBody(before, 't_1', null);
  assert.equal(cleared.changed, true);
  assert.equal(
    cleared.newText,
    ['<!-- long-term-plan:format=v1 -->', '', '# T', '', '- [ ] A <!-- long-term-plan:id=t_1 -->', ''].join('\n')
  );
});

test('applySetPlanBody inserts a plan-level blockquote body under the first H1', () => {
  // Plan body lives under the first H1 so it is naturally near the plan title.
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '## Inbox',
    '',
  ].join('\n');

  const after = applySetPlanBody(before, 'Plan intro').newText;
  assert.equal(
    after,
    [
      '<!-- long-term-plan:format=v1 -->',
      '',
      '# Title',
      '',
      '> Plan intro',
      '## Inbox',
      '',
    ].join('\n')
  );

  const validation = validatePlanMarkdown(after);
  assert.equal(validation.errors.length, 0);
});
