/**
 * End-to-end tests for writing blockquote bodies and reading them back.
 *
 * Scope:
 * - `task.add` / `task.update` can write `bodyMarkdown` to disk (as blockquotes)
 * - `task.get` can read the body back (default includeBody=true)
 * - `plan.update` can write the plan-level body and `plan.get` can read it back
 *
 * These tests intentionally go through the MCP tool boundary using the
 * in-memory transport so we cover:
 * - Zod schemas + tool routing
 * - file reads/writes + etag behavior
 * - parsing/encoding of blockquote bodies
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  // Helper that throws a richer error message if a tool call fails.
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`Tool failed (${name}): ${toolText(result)}`);
  }
  return result;
}

async function createTempRoot() {
  // Keep temp dirs under the repo so they are easy to locate/clean locally.
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  return {
    rootDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

test('MCP bodies roundtrip: task.add + task.update bodyMarkdown writes to disk and reads back', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callToolOk(client, 'plan.create', { planId: 'demo', title: 'Demo Plan', template: 'basic' });
    let etag = (await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' })).structuredContent.etag;

    const body1 = ['- [ ] checkbox in task body', '', '```ts', 'const x = 1', '```'].join('\n');
    const added = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'Task with body',
      status: 'todo',
      sectionPath: ['Inbox'],
      bodyMarkdown: body1,
      ifMatch: etag,
    });
    const taskId = added.structuredContent.taskId;
    etag = added.structuredContent.etag;

    // Persisted markdown should include indented blockquote body lines.
    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const textAfterAdd = await readFile(planPath, 'utf8');
    assert.match(textAfterAdd, new RegExp(`<!-- long-term-plan:id=${taskId} -->`));
    assert.ok(textAfterAdd.includes('  > - [ ] checkbox in task body'));
    assert.ok(textAfterAdd.includes('  > ```ts'));
    assert.ok(textAfterAdd.includes('  > const x = 1'));

    // Reading via task.get should decode the body by default.
    const fetched1 = (await callToolOk(client, 'task.get', { planId: 'demo', taskId })).structuredContent.task;
    assert.equal(fetched1.id, taskId);
    assert.ok(typeof fetched1.bodyMarkdown === 'string');
    assert.ok(fetched1.bodyMarkdown.includes('checkbox in task body'));

    // Updating bodyMarkdown should replace the previous body on disk and in reads.
    const body2 = ['Updated intro line', '', '- [ ] another checkbox'].join('\n');
    const updated = await callToolOk(client, 'task.update', {
      planId: 'demo',
      taskId,
      bodyMarkdown: body2,
      ifMatch: etag,
    });
    etag = updated.structuredContent.etag;

    const textAfterUpdate = await readFile(planPath, 'utf8');
    assert.ok(!textAfterUpdate.includes('checkbox in task body'));
    assert.ok(textAfterUpdate.includes('  > Updated intro line'));
    assert.ok(textAfterUpdate.includes('  > - [ ] another checkbox'));

    const fetched2 = (await callToolOk(client, 'task.get', { planId: 'demo', taskId })).structuredContent.task;
    assert.ok(fetched2.bodyMarkdown.includes('Updated intro line'));
    assert.ok(fetched2.bodyMarkdown.includes('another checkbox'));
  } finally {
    await client.close();
    await cleanup();
  }
});

test('MCP bodies roundtrip: plan.update bodyMarkdown writes to disk and reads back via plan.get', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callToolOk(client, 'plan.create', { planId: 'demo', title: 'Demo Plan', template: 'basic' });

    // Plan bodies are opt-in for reads: plan.get defaults to omitting `bodyMarkdown`.
    let etag = (await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' })).structuredContent.etag;

    const planBody = ['Plan intro line 1', '', '- [ ] checkbox in plan body'].join('\n');
    const updated = await callToolOk(client, 'plan.update', {
      planId: 'demo',
      bodyMarkdown: planBody,
      ifMatch: etag,
    });
    etag = updated.structuredContent.etag;

    // Persisted markdown should include a top-level blockquote run under the first H1.
    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const textAfterUpdate = await readFile(planPath, 'utf8');
    assert.ok(textAfterUpdate.includes('> Plan intro line 1'));
    assert.ok(textAfterUpdate.includes('> - [ ] checkbox in plan body'));

    const defaultPlan = (await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree' })).structuredContent
      .plan;
    assert.equal(defaultPlan.hasBody, true);
    assert.equal('bodyMarkdown' in defaultPlan, false);

    const withPlanBody = (
      await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree', includePlanBody: true })
    ).structuredContent.plan;
    assert.ok(withPlanBody.bodyMarkdown.includes('Plan intro line 1'));

    // Clearing a plan body should remove the blockquote run on disk and in reads.
    const cleared = await callToolOk(client, 'plan.update', { planId: 'demo', clearBody: true, ifMatch: etag });
    etag = cleared.structuredContent.etag;

    const textAfterClear = await readFile(planPath, 'utf8');
    assert.ok(!textAfterClear.includes('> Plan intro line 1'));
    const planAfterClear = (
      await callToolOk(client, 'plan.get', { planId: 'demo', view: 'tree', includePlanBody: true })
    ).structuredContent.plan;
    assert.equal(planAfterClear.hasBody, false);
    assert.equal('bodyMarkdown' in planAfterClear, false);
  } finally {
    await client.close();
    await cleanup();
  }
});
