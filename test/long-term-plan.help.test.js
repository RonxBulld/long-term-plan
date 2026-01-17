/**
 * long-term-plan help text tests.
 *
 * Goal: keep CLI help stable and ensure important notes are documented.
 * This is used as a contract for both humans and automated agents.
 *
 * We match specific phrases (not snapshots) to avoid brittle tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { runLongTermPlanCli } from '../dist/long-term-plan.js';

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

test('long-term-plan --help documents --body-file as relative to cwd', async () => {
  const captured = createCapturedIo();
  const code = await runLongTermPlanCli(['--help'], captured.io);
  assert.equal(code, 0);
  assert.equal(captured.getStderr().trim(), '');

  assert.match(
    captured.getStdout(),
    /--body-file paths are resolved relative to the current working directory/
  );
});
