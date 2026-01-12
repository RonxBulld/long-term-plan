import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlanMarkdown } from '../dist/todo/parse.js';

test('parsePlanMarkdown parses tasks and hierarchy', () => {
  const text = [
    '<!-- long-term-plan:format=v1 -->',
    '',
    '# Title',
    '',
    '## Section',
    '',
    '- [ ] Parent <!-- long-term-plan:id=t_a -->',
    '  - [*] Child <!-- long-term-plan:id=t_b -->',
    '  - [√] Child 2 <!-- long-term-plan:id=t_c -->',
    '',
  ].join('\n');

  const result = parsePlanMarkdown(text);
  assert.equal(result.ok, true);
  assert.ok(result.plan);
  assert.equal(result.plan.title, 'Title');
  assert.equal(result.plan.rootTasks.length, 1);
  assert.equal(result.plan.rootTasks[0].id, 't_a');
  assert.equal(result.plan.rootTasks[0].children.length, 2);
  assert.equal(result.plan.rootTasks[0].children[0].status, 'doing');
  assert.deepEqual(result.plan.rootTasks[0].children[0].sectionPath, ['Section']);
});
