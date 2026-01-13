/**
 * Deploy script tests.
 *
 * These tests run the deploy CLI in a subprocess with HOME redirected to a
 * workspace-local temp directory, so we never touch the real user machine.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function createTempHome() {
  const homeDir = await mkdtemp(join(process.cwd(), '.tmp-long-term-plan-deploy-'));
  return {
    homeDir,
    cleanup: async () => {
      await rm(homeDir, { recursive: true, force: true });
    },
  };
}

function runNode(args, { env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk?.toString?.() ?? String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk?.toString?.() ?? String(chunk);
    });
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

test('deploy-skills: --dry-run does not write', async () => {
  const { homeDir, cleanup } = await createTempHome();
  try {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    const result = await runNode(['scripts/deploy-skills.js', '--target', 'codex', '--dry-run'], { env });
    assert.equal(result.code, 0, `expected exit code 0 (stderr=${result.stderr})`);

    const destRoot = join(homeDir, '.codex', 'skills');
    assert.equal(await pathExists(destRoot), false);
  } finally {
    await cleanup();
  }
});

test('deploy-skills: copies to codex root and enforces --force', async () => {
  const { homeDir, cleanup } = await createTempHome();
  try {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    const destRoot = join(homeDir, '.codex', 'skills');
    const destSkillDir = join(destRoot, 'long-term-plan');

    const first = await runNode(['scripts/deploy-skills.js', '--target', 'codex'], { env });
    assert.equal(first.code, 0, `expected exit code 0 (stderr=${first.stderr})`);

    assert.equal(await pathExists(destSkillDir), true);
    assert.equal(await pathExists(join(destSkillDir, 'SKILL.md')), true);
    assert.equal(await pathExists(join(destSkillDir, 'scripts', 'lib', 'ltp.js')), true);
    if (process.platform !== 'win32') {
      const mode = (await stat(join(destSkillDir, 'scripts', 'ltp'))).mode;
      assert.ok((mode & 0o111) !== 0, 'expected scripts/ltp to be executable');
    }

    const noForce = await runNode(['scripts/deploy-skills.js', '--target', 'codex'], { env });
    assert.equal(noForce.code, 1, 'expected non-zero exit when destination exists');
    assert.match(noForce.stderr, /Destination exists:/);

    const forced = await runNode(['scripts/deploy-skills.js', '--target', 'codex', '--force'], { env });
    assert.equal(forced.code, 0, `expected exit code 0 (stderr=${forced.stderr})`);
  } finally {
    await cleanup();
  }
});
