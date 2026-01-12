import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../dist/server.js';

function toolText(result) {
  return (result.content ?? [])
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

async function callToolOk(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`Tool failed (${name}): ${toolText(result)}`);
  }
  return result;
}

async function createTempRoot() {
  const baseDir = resolve('.tmp');
  await mkdir(baseDir, { recursive: true });
  const rootDir = await mkdtemp(join(baseDir, 'long-term-plan-'));
  return {
    rootDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}

test('MCP integration: create plan, mutate tasks, validate final state', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const toolsList = await client.listTools();
    const toolNames = new Set((toolsList?.tools ?? []).map((t) => t.name));
    assert.ok(toolNames.has('plan.create'));
    assert.ok(toolNames.has('plan.get'));
    assert.ok(toolNames.has('task.add'));
    assert.ok(toolNames.has('task.setStatus'));
    assert.ok(toolNames.has('task.rename'));
    assert.ok(toolNames.has('task.delete'));
    assert.ok(toolNames.has('doc.validate'));

    const created = await callToolOk(client, 'plan.create', {
      planId: 'demo',
      title: 'Demo Plan',
      template: 'basic',
    });
    assert.deepEqual(created.structuredContent, { planId: 'demo', path: '.long-term-plan/demo.md' });

    const initial = await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' });
    assert.equal(initial.structuredContent.plan.title, 'Demo Plan');
    assert.equal(initial.structuredContent.plan.stats.total, 0);
    let etag = initial.structuredContent.etag;

    const added = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'Task A',
      sectionPath: ['Inbox'],
      ifMatch: etag,
    });
    const parentTaskId = added.structuredContent.taskId;
    assert.match(parentTaskId, /^t_[a-f0-9]{32}$/);
    etag = added.structuredContent.etag;

    const fileTextAfterAdd = await readFile(join(rootDir, '.long-term-plan', 'demo.md'), 'utf8');
    assert.match(fileTextAfterAdd, /<!-- long-term-plan:format=v1 -->/);
    assert.match(fileTextAfterAdd, new RegExp(`<!-- long-term-plan:id=${parentTaskId} -->`));

    const started = await callToolOk(client, 'task.setStatus', {
      planId: 'demo',
      taskId: parentTaskId,
      status: 'doing',
      ifMatch: etag,
    });
    etag = started.structuredContent.etag;

    const renamed = await callToolOk(client, 'task.rename', {
      planId: 'demo',
      taskId: parentTaskId,
      title: 'Task A (renamed)',
      ifMatch: etag,
    });
    etag = renamed.structuredContent.etag;

    const childAdded = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'Child task',
      parentTaskId,
      ifMatch: etag,
    });
    const childTaskId = childAdded.structuredContent.taskId;
    assert.match(childTaskId, /^t_[a-f0-9]{32}$/);
    etag = childAdded.structuredContent.etag;

    const afterMutations = await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' });
    assert.equal(afterMutations.structuredContent.plan.stats.total, 2);
    assert.equal(afterMutations.structuredContent.plan.stats.doing, 1);

    const tasks = afterMutations.structuredContent.plan.tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, parentTaskId);
    assert.equal(tasks[0].title, 'Task A (renamed)');
    assert.equal(tasks[0].status, 'doing');
    assert.equal(tasks[0].children.length, 1);
    assert.equal(tasks[0].children[0].id, childTaskId);
    assert.equal(tasks[0].children[0].title, 'Child task');

    const deleted = await callToolOk(client, 'task.delete', {
      planId: 'demo',
      taskId: parentTaskId,
      ifMatch: etag,
    });
    etag = deleted.structuredContent.etag;

    const afterDelete = await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' });
    assert.equal(afterDelete.structuredContent.plan.stats.total, 0);

    const validate = await callToolOk(client, 'doc.validate', { planId: 'demo' });
    assert.equal(validate.structuredContent.errors.length, 0);

    const conflict = await client.callTool({
      name: 'task.add',
      arguments: { planId: 'demo', title: 'should-conflict', ifMatch: 'deadbeef' },
    });
    assert.equal(conflict.isError, true);
    assert.match(toolText(conflict), /CONFLICT/);
  } finally {
    await client.close();
    await cleanup();
  }
});
