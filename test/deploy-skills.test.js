/**
 * Deploy script tests.
 *
 * These tests run the deploy CLI in a subprocess with HOME redirected to a
 * workspace-local temp directory, so we never touch the real user machine.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
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

// Run the deploy script in a subprocess (instead of importing its functions)
// so the tests reflect real CLI behavior, including stdout/stderr messages.
// Captures output for assertions and keeps the test process isolated from any
// accidental global side effects.
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
    assert.equal(await pathExists(join(destSkillDir, 'scripts', 'lib', 'long-term-plan.js')), true);
    if (process.platform !== 'win32') {
      const mode = (await stat(join(destSkillDir, 'scripts', 'long-term-plan'))).mode;
      assert.ok((mode & 0o111) !== 0, 'expected scripts/long-term-plan to be executable');
    }

    const noForce = await runNode(['scripts/deploy-skills.js', '--target', 'codex'], { env });
    assert.equal(noForce.code, 1, 'expected non-zero exit when destination exists');
    assert.match(noForce.stderr, /Destination exists:/);

    // Force deploy should start from a clean directory so old files can't linger.
    await writeFile(join(destSkillDir, 'OLD_FILE'), 'stale', 'utf8');
    assert.equal(await pathExists(join(destSkillDir, 'OLD_FILE')), true);

    const forced = await runNode(['scripts/deploy-skills.js', '--target', 'codex', '--force'], { env });
    assert.equal(forced.code, 0, `expected exit code 0 (stderr=${forced.stderr})`);
    assert.equal(await pathExists(join(destSkillDir, 'OLD_FILE')), false);
  } finally {
    await cleanup();
  }
});

/**
 * Multi-target deploy should install into both Codex and Claude roots, so a
 * single `--target both` invocation is enough for most local setups.
 */
test('deploy-skills: --target both copies to codex + claude roots', async () => {
  const { homeDir, cleanup } = await createTempHome();
  try {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    const result = await runNode(['scripts/deploy-skills.js', '--target', 'both'], { env });
    assert.equal(result.code, 0, `expected exit code 0 (stderr=${result.stderr})`);

    assert.equal(await pathExists(join(homeDir, '.codex', 'skills', 'long-term-plan', 'SKILL.md')), true);
    assert.equal(await pathExists(join(homeDir, '.claude', 'skills', 'long-term-plan', 'SKILL.md')), true);
  } finally {
    await cleanup();
  }
});

/**
 * When deploying to both targets, an already-installed directory should not
 * block installing into the other target (users commonly have one configured
 * before the other).
 */
test('deploy-skills: --target both skips existing and still installs missing target', async () => {
  const { homeDir, cleanup } = await createTempHome();
  try {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    const codexSkillDir = join(homeDir, '.codex', 'skills', 'long-term-plan');
    await mkdir(codexSkillDir, { recursive: true });
    await writeFile(join(codexSkillDir, 'PREEXISTING'), 'keep', 'utf8');

    const result = await runNode(['scripts/deploy-skills.js', '--target', 'both'], { env });
    assert.equal(result.code, 0, `expected exit code 0 (stderr=${result.stderr})`);
    assert.match(result.stdout, /skip existing:/);

    assert.equal(await pathExists(join(codexSkillDir, 'PREEXISTING')), true);
    assert.equal(await pathExists(join(codexSkillDir, 'SKILL.md')), false);

    assert.equal(await pathExists(join(homeDir, '.claude', 'skills', 'long-term-plan', 'SKILL.md')), true);
  } finally {
    await cleanup();
  }
});
