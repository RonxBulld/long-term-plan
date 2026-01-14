import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createMcpServer } from '../dist/server.js';

/**
 * Defaults + safety checks for `task.update` when `taskId` is omitted.
 *
 * This is where an agent can easily make mistakes if the server is permissive.
 * We want strict, predictable selection rules:
 * - if there is exactly one `doing` task, it is the default target
 * - otherwise, if there is exactly one unfinished task, it is the default target
 * - ambiguous cases must throw (never guess)
 *
 * Because default targeting is a write, it must be gated behind:
 * - `allowDefaultTarget: true` (explicit caller intent)
 * - `ifMatch` etag (concurrency safety)
 *
 * Test structure:
 * - we call the MCP tool handlers directly to cover Zod validation + routing
 * - we use a temporary `rootDir` so tests do not touch the real plans folder
 * - we fetch `etag` from `plan.get` before attempting any write operations
 * - we assert on the persisted markdown output, not just returned JSON
 * - fixture markdown uses stable task ids for deterministic assertions
 * - temporary directories are cleaned up even if the test fails
 */
function getTool(server, name) {
  const tool = server?._registeredTools?.[name];
  assert.ok(tool, `tool ${name} should be registered`);
  return tool;
}

// Test helper: writes a plan file to a temporary root directory.
async function writePlan(rootDir, planId, text) {
  const plansDir = join(rootDir, '.long-term-plan');
  await mkdir(plansDir, { recursive: true });
  await writeFile(join(plansDir, `${planId}.md`), text, 'utf8');
}

test('task.update can default taskId with allowDefaultTarget + ifMatch (status only)', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    // Scenario: exactly one `doing` task exists -> default targeting is allowed.
    await writePlan(
      rootDir,
      'demo',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Demo Plan',
        '',
        '## Inbox',
        '',
        '- [ ] Task A <!-- long-term-plan:id=t_a -->',
        '- [*] Task B <!-- long-term-plan:id=t_b -->',
        '- [ ] Task C <!-- long-term-plan:id=t_c -->',
        '',
      ].join('\n')
    );

	    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
	    const getPlan = getTool(server, 'plan.get');
	    const update = getTool(server, 'task.update');

	    // Writes should use an etag precondition to avoid lost updates.
	    const etag = (await getPlan.handler({ planId: 'demo' })).structuredContent.etag;
	    const result = await update.handler({
	      planId: 'demo',
	      status: 'done',
      allowDefaultTarget: true,
      ifMatch: etag,
    });

    // It should resolve the default to the doing task id.
    assert.equal(result.structuredContent.taskId, 't_b');

    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const text = await readFile(planPath, 'utf8');
    // The change should be visible in persisted markdown.
    assert.ok(text.includes('- [√] Task B <!-- long-term-plan:id=t_b -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update can default taskId with allowDefaultTarget + ifMatch (status + title)', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    // Scenario: default targeting + multi-field update (status + title).
    await writePlan(
      rootDir,
      'demo',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Demo Plan',
        '',
        '## Inbox',
        '',
        '- [ ] Task A <!-- long-term-plan:id=t_a -->',
        '- [*] Task B <!-- long-term-plan:id=t_b -->',
        '',
      ].join('\n')
    );

	    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
	    const getPlan = getTool(server, 'plan.get');
	    const update = getTool(server, 'task.update');

	    // The etag is required for default targeting, even in tests.
	    const etag = (await getPlan.handler({ planId: 'demo' })).structuredContent.etag;
	    const result = await update.handler({
	      planId: 'demo',
	      status: 'done',
      title: 'Task B (renamed)',
      allowDefaultTarget: true,
      ifMatch: etag,
    });

    // It should still pick the same resolved default id.
    assert.equal(result.structuredContent.taskId, 't_b');

    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const text = await readFile(planPath, 'utf8');
    // Both status and title should be updated.
    assert.ok(text.includes('- [√] Task B (renamed) <!-- long-term-plan:id=t_b -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update can update title only', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    // Scenario: explicit taskId update does not require allowDefaultTarget.
    await writePlan(
      rootDir,
      'demo',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Demo Plan',
        '',
        '## Inbox',
        '',
        '- [*] Task A <!-- long-term-plan:id=t_a -->',
        '',
      ].join('\n')
    );

    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const getPlan = getTool(server, 'plan.get');
    const update = getTool(server, 'task.update');

    const etag = (await getPlan.handler({ planId: 'demo' })).structuredContent.etag;
    const result = await update.handler({
      planId: 'demo',
      taskId: 't_a',
      title: 'Task A (renamed)',
      ifMatch: etag,
    });

    // Returned taskId should match the explicit target.
    assert.equal(result.structuredContent.taskId, 't_a');

    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const text = await readFile(planPath, 'utf8');
    assert.ok(text.includes('- [*] Task A (renamed) <!-- long-term-plan:id=t_a -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update requires at least one of status or title', async () => {
  // Schema-level validation: no-op updates are rejected early.
  const server = createMcpServer({ rootDir: '.', plansDir: '.long-term-plan' });
  const update = getTool(server, 'task.update');
  await assert.rejects(
    update.handler({ planId: 'demo' }),
    /At least one of status, title, bodyMarkdown, or clearBody is required/
  );
});

test('task.update requires ifMatch when taskId is omitted', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    // Safety: default targeting is not allowed without an etag precondition.
    await writePlan(
      rootDir,
      'demo',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Demo Plan',
        '',
        '## Inbox',
        '',
        '- [*] Task A <!-- long-term-plan:id=t_a -->',
        '',
      ].join('\n')
    );

    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const update = getTool(server, 'task.update');

    await assert.rejects(
      update.handler({ planId: 'demo', status: 'done', allowDefaultTarget: true }),
      /ifMatch is required/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update rejects default targeting when multiple doing tasks exist', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    // Ambiguity: two doing tasks means the default is not unique.
    await writePlan(
      rootDir,
      'demo',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Demo Plan',
        '',
        '## Inbox',
        '',
        '- [*] Task A <!-- long-term-plan:id=t_a -->',
        '- [*] Task B <!-- long-term-plan:id=t_b -->',
        '',
      ].join('\n')
    );

    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const getPlan = getTool(server, 'plan.get');
    const update = getTool(server, 'task.update');

    const etag = (await getPlan.handler({ planId: 'demo' })).structuredContent.etag;
    await assert.rejects(
      update.handler({
        planId: 'demo',
        status: 'done',
        allowDefaultTarget: true,
        ifMatch: etag,
      }),
      /AMBIGUOUS/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
