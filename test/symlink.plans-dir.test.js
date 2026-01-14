/**
 * Symlink behavior tests.
 *
 * Rationale: this project intentionally performs only lexical root checks for
 * `rootDir` boundaries (path traversal), and does not resolve symlinks. Users
 * may rely on this to keep their plan docs outside the configured root.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listPlans, taskAdd } from '../dist/todo/api.js';

async function createTempDir(prefix) {
  return mkdtemp(join(process.cwd(), prefix));
}

test('plansDir symlink is followed (intentional)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symlink permissions vary on Windows; skip for determinism');
    return;
  }

  const rootDir = await createTempDir('.tmp-long-term-plan-root-');
  const outsideDir = await createTempDir('.tmp-long-term-plan-outside-');
  try {
    const outsidePlansDir = join(outsideDir, 'plans');
    await mkdir(outsidePlansDir, { recursive: true });

    const outsidePlanPath = join(outsidePlansDir, 'demo.md');
    await writeFile(
      outsidePlanPath,
      ['<!-- long-term-plan:format=v1 -->', '', '# Demo', '', '## Inbox', ''].join('\n'),
      'utf8'
    );

    // rootDir/.long-term-plan -> outsideDir/plans (outside rootDir)
    await symlink(outsidePlansDir, join(rootDir, '.long-term-plan'));

    const listed = await listPlans({ rootDir, plansDir: '.long-term-plan' }, { query: undefined });
    assert.deepEqual(listed.map((p) => p.planId), ['demo']);

    const added = await taskAdd(
      { rootDir, plansDir: '.long-term-plan' },
      { planId: 'demo', title: 'Hello', sectionPath: ['Inbox'] }
    );

    const updatedText = await readFile(outsidePlanPath, 'utf8');
    assert.ok(updatedText.includes('Hello'));
    assert.ok(updatedText.includes(`<!-- long-term-plan:id=${added.taskId} -->`));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

