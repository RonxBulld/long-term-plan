/**
 * Server wiring tests (no transport).
 *
 * These tests ensure:
 * - tools are registered with the expected names
 * - `planId` is required in tool schemas (no implicit default plan)
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createMcpServer } from '../dist/server.js';

function getTool(server, name) {
  // `_registeredTools` is an internal detail of the MCP server implementation,
  // but using it here keeps tests fast (no transport needed for schema checks).
  const tool = server?._registeredTools?.[name];
  assert.ok(tool, `tool ${name} should be registered`);
  return tool;
}

test('MCP tools require explicit planId', () => {
  const server = createMcpServer({ rootDir: '.', plansDir: '.long-term-plan' });

  assert.equal(getTool(server, 'plan.get').inputSchema.safeParse({}).success, false);
  assert.equal(getTool(server, 'plan.get').inputSchema.safeParse({ planId: 'demo' }).success, true);

  assert.equal(getTool(server, 'task.get').inputSchema.safeParse({}).success, false);
  assert.equal(getTool(server, 'task.get').inputSchema.safeParse({ planId: 'demo' }).success, true);
  assert.equal(
    getTool(server, 'task.get').inputSchema.safeParse({ planId: 'demo', taskId: 't_a' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.add').inputSchema.safeParse({ title: 'hello' }).success,
    false
  );
  assert.equal(
    getTool(server, 'task.add').inputSchema.safeParse({ planId: 'demo', title: 'hello' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.update').inputSchema.safeParse({ taskId: 't_a', status: 'todo' }).success,
    false
  );
  assert.equal(
    getTool(server, 'task.update').inputSchema.safeParse({
      planId: 'demo',
      taskId: 't_a',
      status: 'todo',
    }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.update').inputSchema.safeParse({
      planId: 'demo',
      title: 'new',
      allowDefaultTarget: true,
    }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.delete').inputSchema.safeParse({ taskId: 't_a' }).success,
    false
  );
  assert.equal(
    getTool(server, 'task.delete').inputSchema.safeParse({ planId: 'demo', taskId: 't_a' }).success,
    true
  );

  assert.equal(getTool(server, 'task.search').inputSchema.safeParse({ query: 'x' }).success, false);
  assert.equal(
    getTool(server, 'task.search').inputSchema.safeParse({ planId: 'demo', query: 'x' }).success,
    true
  );
});

test('legacy doc.* tool names are opt-in', () => {
  const server = createMcpServer({ rootDir: '.', plansDir: '.long-term-plan' });
  assert.equal(server?._registeredTools?.['doc.validate'] !== undefined, false);
  assert.equal(server?._registeredTools?.['doc.repair'] !== undefined, false);

  const legacy = createMcpServer({
    rootDir: '.',
    plansDir: '.long-term-plan',
    exposeLegacyDocTools: true,
  });
  assert.equal(getTool(legacy, 'doc.validate').inputSchema.safeParse({}).success, false);
  assert.equal(getTool(legacy, 'doc.validate').inputSchema.safeParse({ planId: 'demo' }).success, true);
  assert.equal(
    getTool(legacy, 'doc.repair').inputSchema.safeParse({ actions: ['addFormatHeader'] }).success,
    false
  );
  assert.equal(
    getTool(legacy, 'doc.repair').inputSchema.safeParse({
      planId: 'demo',
      actions: ['addFormatHeader'],
    }).success,
    true
  );
});

test('task.add requires planId and does not auto-create a default plan', async () => {
  // Use a temp directory so we can assert on actual files without polluting the repo.
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const create = getTool(server, 'plan.create');
    const getPlan = getTool(server, 'plan.get');
    const add = getTool(server, 'task.add');

    await assert.rejects(add.handler({ title: 'Hello world' }));

    await create.handler({ planId: 'demo', title: 'Demo Plan', template: 'basic' });
    const etag = (await getPlan.handler({ planId: 'demo' })).structuredContent.etag;
    await add.handler({ planId: 'demo', title: 'Hello world', ifMatch: etag });

    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const text = await readFile(planPath, 'utf8');

    // Plan file should be created with a format header, title, and the new task.
    assert.ok(text.includes('<!-- long-term-plan:format=v1 -->'));
    assert.ok(text.includes('# Demo Plan'));
    assert.ok(text.includes('Hello world'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
