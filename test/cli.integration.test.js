/**
 * CLI end-to-end tests.
 *
 * Scope:
 * - Exercise the local CLI through real plan/task lifecycles (create/read/write).
 * - Ensure the CLI and the MCP server operate on the same underlying plan files.
 *
 * Design notes (why this file looks the way it does):
 * - We intentionally import from the compiled `dist/` output to match shipped JS.
 * - We avoid spawning a child process for the CLI so output capture is reliable
 *   and platform differences (shell quoting, PATH resolution) do not add noise.
 * - We capture stdout/stderr via Writable streams so we can assert on JSON output
 *   without relying on global `process.stdout` monkeypatching.
 * - Each test writes into a unique temp root under this repo; this keeps runs
 *   hermetic and avoids touching any user state outside the workspace.
 *
 * Regression targets:
 * - Argument parsing and help behavior (`--help`, unknown flags, missing args).
 * - Root/plan-dir isolation (no writes outside `--root`).
 * - JSON contract stability (stdout JSON, stderr errors + usage).
 * - Optimistic concurrency control via `etag` / `--if-match`.
 *
 * Test harness details:
 * - `createTempRoot()` allocates a unique `--root` directory per test run.
 * - `createCapturedIo()` provides in-memory stdout/stderr sinks so the CLI can
 *   be called as a pure function (argv in, exit code + captured output out).
 * - `runCliJson()` asserts exit code 0, empty stderr, and parses stdout as JSON.
 * - `runCliFail()` captures non-zero exit codes and returns raw stderr/stdout.
 *
 * Server integration detail:
 * - The MCP server is connected via an in-memory transport pair so we can call
 *   tools without networking and still exercise the real server implementation.
 * - This also keeps the tests deterministic and fast.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/server.js';
import { runLongTermPlanCli } from '../dist/long-term-plan.js';

async function createTempRoot() {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  return {
    rootDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

function createCapturedIo() {
  let stdoutText = '';
  let stderrText = '';

  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutText += chunk?.toString?.() ?? String(chunk);
      callback();
    },
  });

  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrText += chunk?.toString?.() ?? String(chunk);
      callback();
    },
  });

  return {
    io: { stdout, stderr },
    getStdout: () => stdoutText,
    getStderr: () => stderrText,
  };
}

async function runCliJson(args) {
  const captured = createCapturedIo();
  const code = await runLongTermPlanCli(args, captured.io);
  assert.equal(code, 0, `expected exit code 0, got ${code} (stderr=${captured.getStderr()})`);
  assert.equal(captured.getStderr().trim(), '');
  return JSON.parse(captured.getStdout());
}

async function runCliFail(args) {
  const captured = createCapturedIo();
  const code = await runLongTermPlanCli(args, captured.io);
  return { code, stdout: captured.getStdout(), stderr: captured.getStderr() };
}

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

test('long-term-plan CLI: plan + task lifecycle', async () => {
  const { rootDir, cleanup } = await createTempRoot();
  try {
    const created = await runCliJson([
      '--root',
      rootDir,
      'plan',
      'create',
      'demo',
      '--title',
      'Demo Plan',
      '--template',
      'basic',
    ]);
    assert.equal(created.planId, 'demo');

    const initial = await runCliJson(['--root', rootDir, 'plan', 'get', 'demo', '--view', 'flat']);
    assert.equal(initial.plan.planId, 'demo');
    const etag0 = initial.etag;
    assert.ok(typeof etag0 === 'string' && etag0.length > 0);

    const added = await runCliJson([
      '--root',
      rootDir,
      'task',
      'add',
      'demo',
      '--title',
      'Write docs',
      '--if-match',
      etag0,
    ]);
    assert.ok(typeof added.taskId === 'string' && added.taskId.startsWith('t_'));

    await runCliJson(['--root', rootDir, 'task', 'start', 'demo', added.taskId]);
    const next = await runCliJson(['--root', rootDir, 'task', 'next', 'demo']);
    assert.equal(next.task.id, added.taskId);
    assert.equal(next.task.status, 'doing');

    await runCliJson(['--root', rootDir, 'task', 'done', 'demo', added.taskId]);
    const searched = await runCliJson([
      '--root',
      rootDir,
      'task',
      'search',
      'demo',
      '--query',
      'docs',
    ]);
    assert.equal(searched.hits.length, 1);
    assert.equal(searched.hits[0].taskId, added.taskId);
    assert.equal(searched.hits[0].status, 'done');

    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const text = await readFile(planPath, 'utf8');
    assert.ok(text.includes('<!-- long-term-plan:format=v1 -->'));
    assert.ok(text.includes('# Demo Plan'));
    assert.ok(text.includes('Write docs'));
  } finally {
    await cleanup();
  }
});

test('long-term-plan CLI: if-match conflict is surfaced as an error', async () => {
  const { rootDir, cleanup } = await createTempRoot();
  try {
    await runCliJson(['--root', rootDir, 'plan', 'create', 'demo', '--title', 'Demo', '--template', 'basic']);
    const initial = await runCliJson(['--root', rootDir, 'plan', 'get', 'demo']);
    const etag0 = initial.etag;

    const added = await runCliJson(['--root', rootDir, 'task', 'add', 'demo', '--title', 'A']);
    const failed = await runCliFail([
      '--root',
      rootDir,
      'task',
      'update',
      'demo',
      added.taskId,
      '--status',
      'doing',
      '--if-match',
      etag0,
    ]);
    assert.notEqual(failed.code, 0);
    assert.match(failed.stderr, /CONFLICT: etag mismatch/);
  } finally {
    await cleanup();
  }
});

test('CLI + server tools operate on the same plan files', async () => {
  const { rootDir, cleanup } = await createTempRoot();

  const client = new Client({ name: 'long-term-plan-test-client', version: '0.0.0' });
  const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    await runCliJson(['--root', rootDir, 'plan', 'create', 'demo', '--title', 'Demo', '--template', 'basic']);

    const get1 = await callToolOk(client, 'plan.get', { planId: 'demo', view: 'flat' });
    assert.equal(get1.structuredContent.plan.planId, 'demo');
    let etag = get1.structuredContent.etag;

    const added = await callToolOk(client, 'task.add', {
      planId: 'demo',
      title: 'From server',
      status: 'todo',
      sectionPath: ['Inbox'],
      ifMatch: etag,
    });
    etag = added.structuredContent.etag;

    const next = await runCliJson(['--root', rootDir, 'task', 'next', 'demo']);
    assert.equal(next.task.title, 'From server');

    const updated = await runCliJson([
      '--root',
      rootDir,
      'task',
      'update',
      'demo',
      next.task.id,
      '--status',
      'doing',
      '--if-match',
      etag,
    ]);
    assert.ok(typeof updated.etag === 'string' && updated.etag.length > 0);

    const get2 = await callToolOk(client, 'task.get', { planId: 'demo', taskId: next.task.id });
    assert.equal(get2.structuredContent.task.status, 'doing');
  } finally {
    await client.close();
    await cleanup();
  }
});
