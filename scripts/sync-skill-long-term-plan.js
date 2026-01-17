import { mkdir, readdir, stat, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Sync the versioned `long-term-plan` skill with the current `dist/` output.
 *
 * Why:
 * - The repo treats both CLI mode (`long-term-plan`) and server mode as first-class.
 * - The skill bundles a runnable CLI, so it must stay in lockstep with `dist/`.
 *
 * What this script does:
 * - Copy `dist/long-term-plan.js` to `agent-skill/long-term-plan/scripts/lib/long-term-plan.js`
 * - Copy `dist/todo/*.js` to `agent-skill/long-term-plan/scripts/lib/todo/*.js`
 * - Update the skill wrapper to run the copied `lib/long-term-plan.js`
 */

const DIST_DIR = resolve('dist');
const SKILL_DIR = resolve('agent-skill/long-term-plan');
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
  const distLongTermPlan = join(DIST_DIR, 'long-term-plan.js');
  const distTodoDir = join(DIST_DIR, 'todo');

  if (!(await pathExists(distLongTermPlan))) {
    throw new Error('Missing dist/long-term-plan.js. Run `npm run build` first.');
  }
  if (!(await pathExists(distTodoDir))) {
    throw new Error('Missing dist/todo/. Run `npm run build` first.');
  }
  if (!(await pathExists(SKILL_DIR))) {
    throw new Error('Missing agent-skill/long-term-plan. Create the skill folder first.');
  }

  await ensureDir(SKILL_TODO_LIB_DIR);

  // Copy the CLI entrypoint.
  await copyFileEnsuringDir(distLongTermPlan, join(SKILL_LIB_DIR, 'long-term-plan.js'));

  // Copy runtime todo modules the CLI imports.
  const todoFiles = (await readdir(distTodoDir))
    .filter((name) => name.endsWith('.js'))
    .sort();
  for (const name of todoFiles) {
    await copyFileEnsuringDir(join(distTodoDir, name), join(SKILL_TODO_LIB_DIR, name));
  }

  // Ensure wrapper points at the synced CLI.
  const wrapperPath = join(SKILL_SCRIPTS_DIR, 'long-term-plan');
  const wrapper = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Wrapper to run the synced CLI shipped with this skill directory.',
    '',
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
    'exec node "${SCRIPT_DIR}/lib/long-term-plan.js" "$@"',
    '',
  ].join('\n');
  await writeFile(wrapperPath, wrapper, 'utf8');
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
