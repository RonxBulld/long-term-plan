/**
 * `applyAddTask` edge/corner-case tests.
 *
 * `applyAddTask` is the only write helper that can operate on a partially invalid
 * document (missing header only). Everything else should fail fast to preserve
 * the "success implies strict v1 validity" guarantee.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAddTask } from '../dist/todo/edit.js';
import { parsePlanMarkdown } from '../dist/todo/parse.js';

function requireOk(text) {
  const parsed = parsePlanMarkdown(text);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.plan);
  return parsed.plan;
}

test('applyAddTask inserts as the last child when parentTaskId is provided', () => {
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '## Inbox',
    '',
    '- [ ] Parent <!-- long-term-plan:id=t_parent -->',
    '  - [ ] Child 1 <!-- long-term-plan:id=t_c1 -->',
    '  - [ ] Child 2 <!-- long-term-plan:id=t_c2 -->',
    '',
  ].join('\n');

  const added = applyAddTask(before, {
    title: 'Inserted child',
    status: 'todo',
    parentTaskId: 't_parent',
  });

  const plan = requireOk(added.newText);
  const parent = plan.tasksById.get('t_parent');
  assert.ok(parent);
  assert.equal(parent.children.length, 3);
  assert.equal(parent.children[2]?.title, 'Inserted child');
  assert.equal(parent.children[2]?.indent, parent.indent + 2);
});

test('applyAddTask creates missing section headings at EOF when sectionPath is new', () => {
  const before = ['<!-- long-term-plan:format=v1 -->', '', '# Title', ''].join('\n');

  const added = applyAddTask(before, {
    title: 'Roadmap task',
    status: 'todo',
    sectionPath: ['Roadmap', 'Q1'],
  });

  assert.ok(added.newText.includes('## Roadmap'));
  assert.ok(added.newText.includes('### Q1'));

  const plan = requireOk(added.newText);
  const task = Array.from(plan.tasksById.values()).find((t) => t.title === 'Roadmap task');
  assert.ok(task);
  assert.deepEqual(task.sectionPath, ['Roadmap', 'Q1']);
});

test('applyAddTask can auto-add a missing format header when it is the only validation error', () => {
  const before = ['# Title', '', '- [ ] Existing <!-- long-term-plan:id=t_existing -->', ''].join('\n');

  const added = applyAddTask(before, {
    title: 'New task',
    status: 'todo',
  });

  assert.ok(added.newText.includes('<!-- long-term-plan:format=v1 -->'));
  const plan = requireOk(added.newText);
  assert.equal(plan.tasksById.has('t_existing'), true);
});

test('applyAddTask refuses to write when the document has non-header validation errors', () => {
  // Duplicate ids should force an explicit repair step rather than guessing.
  const before = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '- [ ] A <!-- long-term-plan:id=t_dup -->',
    '- [ ] B <!-- long-term-plan:id=t_dup -->',
    '',
  ].join('\n');

  assert.throws(
    () =>
      applyAddTask(before, {
        title: 'X',
        status: 'todo',
      }),
    /Refusing to add task: document has validation errors .*DUPLICATE_TASK_ID/
  );
});
