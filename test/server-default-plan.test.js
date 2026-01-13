/**
 * Server wiring tests (no transport).
 *
 * These tests ensure:
 * - tools are registered with the expected names
 * - `planId` is optional in tool schemas where the server provides a default
 * - the "default plan auto-create" behavior works end-to-end on disk
 * - legacy `doc.*` tool names are opt-in
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

test('MCP tools accept omitted planId (defaults to active-plan)', () => {
  const server = createMcpServer({ rootDir: '.', plansDir: '.long-term-plan' });

  // Schemas should accept omitted planId for all defaultable tools.
  assert.equal(getTool(server, 'plan.get').inputSchema.safeParse({}).success, true);
  assert.equal(getTool(server, 'task.get').inputSchema.safeParse({}).success, true);
  assert.equal(
    getTool(server, 'task.get').inputSchema.safeParse({ taskId: 't_a' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.add').inputSchema.safeParse({ title: 'hello' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.update').inputSchema.safeParse({ taskId: 't_a', status: 'todo' }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.update').inputSchema.safeParse({
      title: 'new',
      allowDefaultTarget: true,
    }).success,
    true
  );
  assert.equal(
    getTool(server, 'task.delete').inputSchema.safeParse({ taskId: 't_a' }).success,
    true
  );
  assert.equal(server?._registeredTools?.['doc.validate'] !== undefined, false);
  assert.equal(server?._registeredTools?.['doc.repair'] !== undefined, false);
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
  assert.equal(getTool(legacy, 'doc.validate').inputSchema.safeParse({}).success, true);
  assert.equal(
    getTool(legacy, 'doc.repair').inputSchema.safeParse({ actions: ['addFormatHeader'] }).success,
    true
  );
});

test('task.add without planId auto-creates active-plan.md', async () => {
  // Use a temp directory so we can assert on actual files without polluting the repo.
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const tool = getTool(server, 'task.add');

    await tool.handler({ title: 'Hello world' });

    const planPath = join(rootDir, '.long-term-plan', 'active-plan.md');
    const text = await readFile(planPath, 'utf8');

    // Plan file should be created with a format header, title, and the new task.
    assert.ok(text.includes('<!-- long-term-plan:format=v1 -->'));
    assert.ok(text.includes('# Active Plan'));
    assert.ok(text.includes('Hello world'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
