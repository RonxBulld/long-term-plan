/**
 * Additional end-to-end CRUD sequences using the in-memory transport.
 *
 * These tests intentionally exercise the compiled `dist/` output to match how
 * the MCP server runs in production.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../dist/server.js';

function toolText(result) {
  // The MCP SDK returns tool output as an array of content items; we join all text.
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
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  return {
    rootDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

test('MCP CRUD sequence: plan.list reflects task CRUD + query filter', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callToolOk(client, 'plan.create', {
      planId: 'alpha',
      title: 'Alpha Plan',
      template: 'basic',
    });
    await callToolOk(client, 'plan.create', {
      planId: 'beta',
      title: 'Beta Plan',
      template: 'empty',
    });

    const listedInitial = await callToolOk(client, 'plan.list', {});
    assert.deepEqual(
      listedInitial.structuredContent.plans.map((p) => p.planId),
      ['alpha', 'beta']
    );
    for (const plan of listedInitial.structuredContent.plans) {
      assert.equal(plan.stats.total, 0);
      assert.equal(plan.stats.todo, 0);
      assert.equal(plan.stats.doing, 0);
      assert.equal(plan.stats.done, 0);
    }

    let etagAlpha = (await callToolOk(client, 'plan.get', { planId: 'alpha' })).structuredContent.etag;
    let etagBeta = (await callToolOk(client, 'plan.get', { planId: 'beta' })).structuredContent.etag;

    etagAlpha = (
      await callToolOk(client, 'task.add', {
        planId: 'alpha',
        title: 'Alpha todo',
        status: 'todo',
        sectionPath: ['Inbox'],
        ifMatch: etagAlpha,
      })
    ).structuredContent.etag;
    etagAlpha = (
      await callToolOk(client, 'task.add', {
        planId: 'alpha',
        title: 'Alpha doing',
        status: 'doing',
        sectionPath: ['Inbox'],
        ifMatch: etagAlpha,
      })
    ).structuredContent.etag;

    etagBeta = (
      await callToolOk(client, 'task.add', {
        planId: 'beta',
        title: 'Beta done',
        status: 'done',
        sectionPath: ['Backlog'],
        ifMatch: etagBeta,
      })
    ).structuredContent.etag;

    const listedAfter = await callToolOk(client, 'plan.list', {});
    const plansById = new Map(listedAfter.structuredContent.plans.map((p) => [p.planId, p]));

    assert.equal(plansById.get('alpha')?.stats.total, 2);
    assert.equal(plansById.get('alpha')?.stats.todo, 1);
    assert.equal(plansById.get('alpha')?.stats.doing, 1);
    assert.equal(plansById.get('alpha')?.stats.done, 0);

    assert.equal(plansById.get('beta')?.stats.total, 1);
    assert.equal(plansById.get('beta')?.stats.todo, 0);
    assert.equal(plansById.get('beta')?.stats.doing, 0);
    assert.equal(plansById.get('beta')?.stats.done, 1);

    const filtered = await callToolOk(client, 'plan.list', { query: 'alp' });
    assert.deepEqual(
      filtered.structuredContent.plans.map((p) => p.planId),
      ['alpha']
    );
  } finally {
    await client.close();
    await cleanup();
  }
});

test('MCP CRUD sequence: nested tasks, search, default task, delete child/parent', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callToolOk(client, 'plan.create', {
      planId: 'demo',
      title: 'Demo',
      template: 'basic',
    });

    let etag = (await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' })).structuredContent.etag;

    const parentAdded = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'Parent',
      sectionPath: ['Inbox'],
      ifMatch: etag,
    });
    const parentTaskId = parentAdded.structuredContent.taskId;
    etag = parentAdded.structuredContent.etag;

    const child1Added = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'Child One',
      parentTaskId,
      ifMatch: etag,
    });
    const child1TaskId = child1Added.structuredContent.taskId;
    etag = child1Added.structuredContent.etag;

    const child2Added = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'Child Two',
      parentTaskId,
      ifMatch: etag,
    });
    const child2TaskId = child2Added.structuredContent.taskId;
    etag = child2Added.structuredContent.etag;

    const updated = await callToolOk(client, 'task.update', {
      planId: 'demo',
      taskId: child1TaskId,
      status: 'doing',
      title: 'Child One (doing)',
      ifMatch: etag,
    });
    etag = updated.structuredContent.etag;

    const defaultTask = await callToolOk(client, 'task.get', { planId: 'demo' });
    assert.equal(defaultTask.structuredContent.task.id, child1TaskId);

    const hitsAll = (await callToolOk(client, 'task.search', { planId: 'demo', query: 'child' }))
      .structuredContent.hits;
    const hitIds = new Set(hitsAll.map((h) => h.taskId));
    assert.equal(hitsAll.length, 2);
    assert.ok(hitIds.has(child1TaskId));
    assert.ok(hitIds.has(child2TaskId));

    const hitsDoing = (
      await callToolOk(client, 'task.search', { planId: 'demo', query: 'child', status: 'doing' })
    ).structuredContent.hits;
    assert.equal(hitsDoing.length, 1);
    assert.equal(hitsDoing[0]?.taskId, child1TaskId);

    const deletedChild = await callToolOk(client, 'task.delete', {
      planId: 'demo',
      taskId: child1TaskId,
      ifMatch: etag,
    });
    etag = deletedChild.structuredContent.etag;

    const hitsAfterDelete = (
      await callToolOk(client, 'task.search', { planId: 'demo', query: 'child' })
    ).structuredContent.hits;
    assert.equal(hitsAfterDelete.length, 1);
    assert.equal(hitsAfterDelete[0]?.taskId, child2TaskId);

    const planAfterDelete = await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' });
    assert.equal(planAfterDelete.structuredContent.plan.stats.total, 2);
    assert.equal(planAfterDelete.structuredContent.plan.tasks.length, 1);
    assert.equal(planAfterDelete.structuredContent.plan.tasks[0].id, parentTaskId);
    assert.equal(planAfterDelete.structuredContent.plan.tasks[0].children.length, 1);
    assert.equal(planAfterDelete.structuredContent.plan.tasks[0].children[0].id, child2TaskId);

    await callToolOk(client, 'task.delete', { planId: 'demo', taskId: parentTaskId, ifMatch: etag });
    const finalPlan = await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' });
    assert.equal(finalPlan.structuredContent.plan.stats.total, 0);
  } finally {
    await client.close();
    await cleanup();
  }
});

test('MCP CRUD sequence: optimistic concurrency conflicts + ambiguous default targeting', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callToolOk(client, 'plan.create', {
      planId: 'race',
      title: 'Race',
      template: 'basic',
    });

    const initial = await callToolOk(client, 'plan.get', { planId: 'race', view: 'tree' });
    const etag0 = initial.structuredContent.etag;

    const added = await callToolOk(client, 'task.add', {
      planId: 'race',
      title: 'Task A',
      status: 'doing',
      sectionPath: ['Inbox'],
      ifMatch: etag0,
    });
    const taskA = added.structuredContent.taskId;
    const etag1 = added.structuredContent.etag;

    // Updating with a stale etag should fail.
    const conflictUpdate = await client.callTool({
      name: 'task.update',
      arguments: { planId: 'race', taskId: taskA, status: 'done', ifMatch: etag0 },
    });
    assert.equal(conflictUpdate.isError, true);
    assert.match(toolText(conflictUpdate), /CONFLICT/);

    const updated = await callToolOk(client, 'task.update', {
      planId: 'race',
      taskId: taskA,
      status: 'done',
      ifMatch: etag1,
    });
    const etag2 = updated.structuredContent.etag;

    // Deleting with a stale etag should fail.
    const conflictDelete = await client.callTool({
      name: 'task.delete',
      arguments: { planId: 'race', taskId: taskA, ifMatch: etag1 },
    });
    assert.equal(conflictDelete.isError, true);
    assert.match(toolText(conflictDelete), /CONFLICT/);

    await callToolOk(client, 'task.delete', { planId: 'race', taskId: taskA, ifMatch: etag2 });

    // Create an ambiguous plan state: multiple doing tasks.
    let etag = (await callToolOk(client, 'plan.get', { planId: 'race' })).structuredContent.etag;
    etag = (
      await callToolOk(client, 'task.add', {
        planId: 'race',
        title: 'Doing 1',
        status: 'doing',
        sectionPath: ['Inbox'],
        ifMatch: etag,
      })
    ).structuredContent.etag;
    etag = (
      await callToolOk(client, 'task.add', {
        planId: 'race',
        title: 'Doing 2',
        status: 'doing',
        sectionPath: ['Inbox'],
        ifMatch: etag,
      })
    ).structuredContent.etag;

    const ambiguous = await client.callTool({
      name: 'task.update',
      arguments: { planId: 'race', status: 'done', allowDefaultTarget: true, ifMatch: etag },
    });
    assert.equal(ambiguous.isError, true);
    assert.match(toolText(ambiguous), /AMBIGUOUS/);
  } finally {
    await client.close();
    await cleanup();
  }
});

test('MCP CRUD sequence: legacy doc.validate + doc.repair (dryRun + write)', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({
    rootDir,
    plansDir: '.long-term-plan',
    exposeLegacyDocTools: true,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    // Create a deliberately broken plan doc (missing header + missing ids).
    await mkdir(join(rootDir, '.long-term-plan'), { recursive: true });
    await writeFile(
      join(rootDir, '.long-term-plan', 'broken.md'),
      ['# Broken', '', '## Inbox', '', '- [ ] Task A', '- [*] Task B', ''].join('\n'),
      'utf8'
    );

    const before = await callToolOk(client, 'doc.validate', { planId: 'broken' });
    assert.ok(before.structuredContent.errors.length > 0);
    assert.ok(before.structuredContent.errors.some((e) => e.code === 'MISSING_FORMAT_HEADER'));

    // Dry run should report what would change without writing the file.
    const dryRun = await callToolOk(client, 'doc.repair', {
      planId: 'broken',
      actions: ['addFormatHeader', 'addMissingIds'],
      dryRun: true,
    });
    assert.equal(dryRun.structuredContent.applied.addFormatHeader, true);
    assert.equal(dryRun.structuredContent.applied.addMissingIds, 2);

    const stillBroken = await callToolOk(client, 'doc.validate', { planId: 'broken' });
    assert.ok(stillBroken.structuredContent.errors.some((e) => e.code === 'MISSING_FORMAT_HEADER'));

    const repaired = await callToolOk(client, 'doc.repair', {
      planId: 'broken',
      actions: ['addFormatHeader', 'addMissingIds'],
    });
    assert.equal(repaired.structuredContent.applied.addFormatHeader, true);
    assert.equal(repaired.structuredContent.applied.addMissingIds, 2);

    const after = await callToolOk(client, 'doc.validate', { planId: 'broken' });
    assert.equal(after.structuredContent.errors.length, 0);

    // After repair, the plan should be parseable and editable via task CRUD.
    let etag = (await callToolOk(client, 'plan.get', { planId: 'broken' })).structuredContent.etag;
    etag = (
      await callToolOk(client, 'task.add', {
        planId: 'broken',
        title: 'Task C',
        sectionPath: ['Inbox'],
        ifMatch: etag,
      })
    ).structuredContent.etag;
    const plan = await callToolOk(client, 'plan.get', { planId: 'broken', view: 'tree' });
    assert.equal(plan.structuredContent.plan.stats.total, 3);
  } finally {
    await client.close();
    await cleanup();
  }
});

