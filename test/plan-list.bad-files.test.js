/**
 * plan.list/listPlans robustness tests.
 *
 * Goal: listing plans should be best-effort; one unreadable file must not break
 * listing other readable plan files.
 *
 * Cases covered:
 * - unreadable files (permissions) are skipped
 * - invalid plan ids derived from filenames are skipped
 *
 * This keeps `plan.list` usable in real repos where the plans directory may
 * contain stale/partial files during refactors or sync conflicts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listPlans } from '../dist/todo/api.js';

async function createTempRoot() {
  const rootDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-'));
  return {
    rootDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

test('listPlans skips unreadable plan files', async (t) => {
  if (process.platform === 'win32') {
    t.skip('chmod-based unreadable file test is unix-only');
    return;
  }

  const { rootDir, cleanup } = await createTempRoot();
  try {
    const plansDir = join(rootDir, '.long-term-plan');
    await mkdir(plansDir, { recursive: true });

    await writeFile(
      join(plansDir, 'good.md'),
      ['<!-- long-term-plan:format=v1 -->', '', '# Good', ''].join('\n'),
      'utf8'
    );

    const badPath = join(plansDir, 'bad.md');
    await writeFile(
      badPath,
      ['<!-- long-term-plan:format=v1 -->', '', '# Bad', ''].join('\n'),
      'utf8'
    );
    await chmod(badPath, 0o000);

    const plans = await listPlans({ rootDir, plansDir: '.long-term-plan' }, { query: undefined });
    assert.deepEqual(
      plans.map((p) => p.planId),
      ['good']
    );
  } finally {
    await cleanup();
  }
});

test('listPlans skips plan files with invalid ids derived from filenames', async () => {
  const { rootDir, cleanup } = await createTempRoot();
  try {
    const plansDir = join(rootDir, '.long-term-plan');
    await mkdir(plansDir, { recursive: true });

    await writeFile(
      join(plansDir, 'good.md'),
      ['<!-- long-term-plan:format=v1 -->', '', '# Good', ''].join('\n'),
      'utf8'
    );
    await writeFile(
      join(plansDir, '_bad.md'),
      ['<!-- long-term-plan:format=v1 -->', '', '# Bad', ''].join('\n'),
      'utf8'
    );

    const plans = await listPlans({ rootDir, plansDir: '.long-term-plan' }, { query: undefined });
    assert.deepEqual(plans.map((p) => p.planId), ['good']);
  } finally {
    await cleanup();
  }
});
