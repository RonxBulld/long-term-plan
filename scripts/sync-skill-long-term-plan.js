import { mkdir, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Sync the versioned `long-term-plan` skill with the current `dist/` output.
 *
 * Why:
 * - The repo treats both CLI mode (`ltp`) and server mode as first-class.
 * - The skill bundles a runnable CLI, so it must stay in lockstep with `dist/`.
 *
 * What this script does:
 * - Copy `dist/ltp.js` to `.codex/skills/long-term-plan/scripts/lib/ltp.js`
 * - Copy `dist/todo/*.js` to `.codex/skills/long-term-plan/scripts/lib/todo/*.js`
 * - Update the skill wrapper to run the copied `lib/ltp.js`
 */

const DIST_DIR = resolve('dist');
const SKILL_DIR = resolve('.codex/skills/long-term-plan');
const SKILL_SCRIPTS_DIR = join(SKILL_DIR, 'scripts');
const SKILL_LIB_DIR = join(SKILL_SCRIPTS_DIR, 'lib');
const SKILL_TODO_LIB_DIR = join(SKILL_LIB_DIR, 'todo');

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function copyFileEnsuringDir(from, to) {
  await ensureDir(dirname(to));
  await copyFile(from, to);
}

async function main() {
  const distLtp = join(DIST_DIR, 'ltp.js');
  const distTodoDir = join(DIST_DIR, 'todo');

  if (!(await pathExists(distLtp))) {
    throw new Error('Missing dist/ltp.js. Run `npm run build` first.');
  }
  if (!(await pathExists(distTodoDir))) {
    throw new Error('Missing dist/todo/. Run `npm run build` first.');
  }
  if (!(await pathExists(SKILL_DIR))) {
    throw new Error('Missing .codex/skills/long-term-plan. Create the skill folder first.');
  }

  await ensureDir(SKILL_TODO_LIB_DIR);

  // Copy the CLI entrypoint.
  await copyFileEnsuringDir(distLtp, join(SKILL_LIB_DIR, 'ltp.js'));

  // Copy runtime todo modules the CLI imports.
  const todoFiles = (await readdir(distTodoDir))
    .filter((name) => name.endsWith('.js'))
    .sort();
  for (const name of todoFiles) {
    await copyFileEnsuringDir(join(distTodoDir, name), join(SKILL_TODO_LIB_DIR, name));
  }

  // Remove the old hand-written skill CLI (kept only before the repo had dist/ltp.js).
  const legacy = join(SKILL_SCRIPTS_DIR, 'ltp.mjs');
  if (await pathExists(legacy)) {
    await rm(legacy, { force: true });
  }

  // Ensure wrapper points at the synced CLI.
  const wrapperPath = join(SKILL_SCRIPTS_DIR, 'ltp');
  const wrapper = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
    'exec node "${SCRIPT_DIR}/lib/ltp.js" "$@"',
    '',
  ].join('\n');
  await writeFile(wrapperPath, wrapper, 'utf8');
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exitCode = 1;
});

