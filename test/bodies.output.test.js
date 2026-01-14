import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createMcpServer } from '../dist/server.js';

/**
 * Output-shape tests for blockquote bodies.
 *
 * The key contract is that bodies remain explicit and opt-in:
 * - `plan.get` returns `hasBody`, but omits `bodyMarkdown` unless requested
 * - `plan.get` can independently include plan body vs task bodies
 * - `task.get` includes `bodyMarkdown` by default (agents typically need it)
 * - when a body exists but is not included, the field must be absent (not `undefined`)
 *
 * This matters because bodies may contain Markdown that looks like tasks
 * (checkboxes, lists, tables, code blocks). Encoding bodies as blockquotes
 * keeps the validator strict while still allowing free-form content.
 */
function getTool(server, name) {
  const tool = server?._registeredTools?.[name];
  assert.ok(tool, `tool ${name} should be registered`);
  return tool;
}

async function writePlan(rootDir, planId, text) {
  const plansDir = join(rootDir, '.long-term-plan');
  await mkdir(plansDir, { recursive: true });
  await writeFile(join(plansDir, `${planId}.md`), text, 'utf8');
}

test('plan.get/task.get body flags control bodyMarkdown inclusion', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    await writePlan(
      rootDir,
      'demo',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Demo Plan',
        '',
        '> Plan intro line 1',
        '>',
        '> - [ ] Plan checkbox',
        '',
        '## Inbox',
        '',
        '- [ ] Task A <!-- long-term-plan:id=t_a -->',
        '  > - [ ] body checkbox',
        '  >',
        '  > ```ts',
        '  > const x = 1',
        '  > ```',
        '- [ ] Task B <!-- long-term-plan:id=t_b -->',
        '',
      ].join('\n')
    );

	    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
	    const planGet = getTool(server, 'plan.get');
	    const taskGet = getTool(server, 'task.get');

	    // Default: plan.get reports `hasBody` but omits `bodyMarkdown` unless requested.
	    const defaultPlan = (await planGet.handler({ planId: 'demo', view: 'tree' })).structuredContent
	      .plan;
	    assert.equal(defaultPlan.hasBody, true);
	    assert.equal('bodyMarkdown' in defaultPlan, false);

    const taskA = defaultPlan.tasks[0];
    assert.equal(taskA.id, 't_a');
    assert.equal(taskA.hasBody, true);
    assert.equal('bodyMarkdown' in taskA, false);

    const withTaskBodies = (await planGet.handler({
      planId: 'demo',
      view: 'tree',
      includeTaskBodies: true,
    })).structuredContent.plan;
    assert.ok(withTaskBodies.tasks[0].bodyMarkdown.includes('body checkbox'));

    const withPlanBody = (await planGet.handler({
      planId: 'demo',
      view: 'tree',
      includePlanBody: true,
    })).structuredContent.plan;
    assert.ok(withPlanBody.bodyMarkdown.includes('Plan intro line 1'));

    const defaultTask = (await taskGet.handler({ planId: 'demo', taskId: 't_a' })).structuredContent
      .task;
    assert.equal(defaultTask.hasBody, true);
    assert.ok(defaultTask.bodyMarkdown.includes('body checkbox'));

    const noBody = (await taskGet.handler({ planId: 'demo', taskId: 't_a', includeBody: false }))
      .structuredContent.task;
    assert.equal(noBody.hasBody, true);
    assert.equal('bodyMarkdown' in noBody, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
