import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createMcpServer } from '../dist/server.js';

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

test('task.get defaults to first doing task when taskId is omitted', async () => {
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
        '## Inbox',
        '',
        '- [ ] Task A <!-- long-term-plan:id=t_a -->',
        '- [*] Task B <!-- long-term-plan:id=t_b -->',
        '- [ ] Task C <!-- long-term-plan:id=t_c -->',
        '',
      ].join('\n')
    );

    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const tool = getTool(server, 'task.get');

    const result = await tool.handler({ planId: 'demo' });
    assert.equal(result.structuredContent.task.id, 't_b');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.get defaults to first unfinished task when no doing task exists', async () => {
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
        '## Inbox',
        '',
        '- [√] Done first <!-- long-term-plan:id=t_done -->',
        '- [ ] Todo next <!-- long-term-plan:id=t_todo -->',
        '- [ ] Todo later <!-- long-term-plan:id=t_todo2 -->',
        '',
      ].join('\n')
    );

    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const tool = getTool(server, 'task.get');

    const result = await tool.handler({ planId: 'demo' });
    assert.equal(result.structuredContent.task.id, 't_todo');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.get throws when taskId is omitted and all tasks are done', async () => {
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
        '## Inbox',
        '',
        '- [√] Done one <!-- long-term-plan:id=t_done1 -->',
        '- [√] Done two <!-- long-term-plan:id=t_done2 -->',
        '',
      ].join('\n')
    );

    const server = createMcpServer({ rootDir, plansDir: '.long-term-plan' });
    const tool = getTool(server, 'task.get');

    await assert.rejects(tool.handler({ planId: 'demo' }), /No unfinished tasks in plan/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
