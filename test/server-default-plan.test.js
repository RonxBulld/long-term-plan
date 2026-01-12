import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createMcpServer } from '../dist/server.js';

function getTool(server, name) {
  const tool = server?._registeredTools?.[name];
  assert.ok(tool, `tool ${name} should be registered`);
  return tool;
}

test('MCP tools accept omitted planId (defaults to active-plan)', () => {
  const server = createMcpServer({ rootDir: '.', plansDir: '.long-term-plan' });

  assert.equal(getTool(server, 'plan.get').inputSchema.safeParse({}).success, true);
  assert.equal(
    getTool(server, 'task.get').inputSchema.safeParse({ taskId: 't_a' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.add').inputSchema.safeParse({ title: 'hello' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.setStatus').inputSchema.safeParse({ taskId: 't_a', status: 'todo' })
      .success,
    true
  );
  assert.equal(
    getTool(server, 'task.rename').inputSchema.safeParse({ taskId: 't_a', title: 'new' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.delete').inputSchema.safeParse({ taskId: 't_a' }).success,
    true
  );
  assert.equal(getTool(server, 'doc.validate').inputSchema.safeParse({}).success, true);
  assert.equal(
    getTool(server, 'doc.repair').inputSchema.safeParse({ actions: ['addFormatHeader'] }).success,
    true
  );
});

test('task.add without planId auto-creates active-plan.md', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const tool = getTool(server, 'task.add');

    await tool.handler({ title: 'Hello world' });

    const planPath = join(rootDir, '.long-term-plan', 'active-plan.md');
    const text = await readFile(planPath, 'utf8');

    assert.ok(text.includes('<!-- long-term-plan:format=v1 -->'));
    assert.ok(text.includes('# Active Plan'));
    assert.ok(text.includes('Hello world'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

