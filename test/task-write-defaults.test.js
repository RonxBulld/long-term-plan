import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('task.update can default taskId with allowDefaultTarget + ifMatch (status only)', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    await writePlan(
      rootDir,
      'active-plan',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Active Plan',
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

    const etag = (await getPlan.handler({})).structuredContent.etag;
    const result = await update.handler({
      status: 'done',
      allowDefaultTarget: true,
      ifMatch: etag,
    });

    assert.equal(result.structuredContent.taskId, 't_b');

    const planPath = join(rootDir, '.long-term-plan', 'active-plan.md');
    const text = await readFile(planPath, 'utf8');
    assert.ok(text.includes('- [√] Task B <!-- long-term-plan:id=t_b -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update can default taskId with allowDefaultTarget + ifMatch (status + title)', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    await writePlan(
      rootDir,
      'active-plan',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Active Plan',
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

    const etag = (await getPlan.handler({})).structuredContent.etag;
    const result = await update.handler({
      status: 'done',
      title: 'Task B (renamed)',
      allowDefaultTarget: true,
      ifMatch: etag,
    });

    assert.equal(result.structuredContent.taskId, 't_b');

    const planPath = join(rootDir, '.long-term-plan', 'active-plan.md');
    const text = await readFile(planPath, 'utf8');
    assert.ok(text.includes('- [√] Task B (renamed) <!-- long-term-plan:id=t_b -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update can update title only', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    await writePlan(
      rootDir,
      'active-plan',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Active Plan',
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

    const etag = (await getPlan.handler({})).structuredContent.etag;
    const result = await update.handler({
      taskId: 't_a',
      title: 'Task A (renamed)',
      ifMatch: etag,
    });

    assert.equal(result.structuredContent.taskId, 't_a');

    const planPath = join(rootDir, '.long-term-plan', 'active-plan.md');
    const text = await readFile(planPath, 'utf8');
    assert.ok(text.includes('- [*] Task A (renamed) <!-- long-term-plan:id=t_a -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update requires at least one of status or title', async () => {
  const server = createMcpServer({ rootDir: '.', plansDir: '.long-term-plan' });
  const update = getTool(server, 'task.update');
  await assert.rejects(update.handler({}), /At least one of status or title is required/);
});

test('task.update requires ifMatch when taskId is omitted', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    await writePlan(
      rootDir,
      'active-plan',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Active Plan',
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
      update.handler({ status: 'done', allowDefaultTarget: true }),
      /ifMatch is required/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.update rejects default targeting when multiple doing tasks exist', async () => {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  try {
    await writePlan(
      rootDir,
      'active-plan',
      [
        '<!-- long-term-plan:format=v1 -->',
        '',
        '# Active Plan',
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

    const etag = (await getPlan.handler({})).structuredContent.etag;
    await assert.rejects(
      update.handler({
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
