/**
 * --body-file behavior tests.
 *
 * Current behavior: `--body-file` is resolved relative to process.cwd(), not `--root`.
 * This is intentional (and documented in help text) so callers can reference
 * local working files while operating on a plan root elsewhere.
 *
 * The test writes two distinct body files (cwd vs root shadow) to detect
 * accidental behavior changes during refactors.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Writable } from 'node:stream';

import { runLongTermPlanCli } from '../dist/long-term-plan.js';

async function createTempDir(prefix) {
  return mkdtemp(join(process.cwd(), prefix));
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

test('long-term-plan plan update --body-file resolves relative to cwd (not --root)', async () => {
  const rootDir = await createTempDir('.tmp-long-term-plan-root-');
  const bodyDir = await createTempDir('.tmp-long-term-plan-bodyfile-');
  try {
    const bodyPath = join(bodyDir, 'body.md');
    await writeFile(bodyPath, 'FROM_CWD\n', 'utf8');

    // Create a "shadow" file under rootDir at the same relative path; if the
    // CLI ever changes to resolve --body-file under --root, this test will fail.
    const relBodyPath = relative(process.cwd(), bodyPath);
    const shadowPath = join(rootDir, relBodyPath);
    await mkdir(dirname(shadowPath), { recursive: true });
    await writeFile(shadowPath, 'FROM_ROOT\n', 'utf8');

    await runCliJson(['--root', rootDir, 'plan', 'create', 'demo', '--title', 'Demo', '--template', 'basic']);
    await runCliJson(['--root', rootDir, 'plan', 'update', 'demo', '--body-file', relBodyPath]);

    const planPath = join(rootDir, '.long-term-plan', 'demo.md');
    const planText = await readFile(planPath, 'utf8');
    assert.ok(planText.includes('FROM_CWD'));
    assert.ok(!planText.includes('FROM_ROOT'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(bodyDir, { recursive: true, force: true });
  }
});
