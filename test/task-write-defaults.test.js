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

test('task.setStatus can default taskId with allowDefaultTarget + ifMatch', async () => {
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
    const setStatus = getTool(server, 'task.setStatus');

    const etag = (await getPlan.handler({})).structuredContent.etag;
    const result = await setStatus.handler({
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

test('task.setStatus requires ifMatch when taskId is omitted', async () => {
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
    const setStatus = getTool(server, 'task.setStatus');

    await assert.rejects(
      setStatus.handler({ status: 'done', allowDefaultTarget: true }),
      /ifMatch is required/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('task.setStatus rejects default targeting when multiple doing tasks exist', async () => {
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
    const setStatus = getTool(server, 'task.setStatus');

    const etag = (await getPlan.handler({})).structuredContent.etag;
    await assert.rejects(
      setStatus.handler({
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

test('task.rename can default taskId with allowDefaultTarget + ifMatch', async () => {
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
    const rename = getTool(server, 'task.rename');

    const etag = (await getPlan.handler({})).structuredContent.etag;
    const result = await rename.handler({
      title: 'Task B (renamed)',
      allowDefaultTarget: true,
      ifMatch: etag,
    });

    assert.equal(result.structuredContent.taskId, 't_b');

    const planPath = join(rootDir, '.long-term-plan', 'active-plan.md');
    const text = await readFile(planPath, 'utf8');
    assert.ok(text.includes('- [*] Task B (renamed) <!-- long-term-plan:id=t_b -->'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

