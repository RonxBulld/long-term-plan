import { writeSync } from 'node:fs';
import { chmod, cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Copy versioned skills from `agent-skill/` into a user-level skills directory.
 *
 * Why this exists:
 * - Repo keeps skills versioned in-tree (`agent-skill/*`) for review and sync.
 * - User-level installs live outside the repo (ex: `~/.codex/skills/*`).
 * - Deployment should be explicit and opt-in (avoid npm lifecycle surprises).
 *
 * Usage examples:
 * - `node scripts/deploy-skills.js --target codex`
 * - `node scripts/deploy-skills.js --target claude --skills long-term-plan`
 * - `node scripts/deploy-skills.js --target both --force`
 */

const SOURCE_SKILLS_DIR = resolve('agent-skill');
const DEFAULT_SKILL_NAMES = null;

function logLine(message) {
  // Note: `console.log` can still drop output in short-lived processes when
  // stdout is a pipe. We use sync fd writes for predictable capture in tests
  // and in CI log collectors.
  // Use sync writes so short-lived CLIs don't drop output when stdout is a pipe.
  writeSync(1, `${message}\n`);
}

function usage() {
  return [
    'deploy-skills: copy agent-skill/* into a user skills directory',
    '',
    'Usage:',
    '  node scripts/deploy-skills.js --target codex|claude|both [options]',
    '',
    'Options:',
    '  --skills <a,b,c>   Only deploy listed skills (default: all under agent-skill/)',
    '  --dest-root <dir>  Override destination root (advanced)',
    '  --force            Overwrite existing deployed skill directories',
    '  --dry-run          Print actions without writing',
    '  --help             Show this help',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  // Minimal flag parsing keeps this script dependency-free and portable.
  // We intentionally fail fast on unknown args to avoid silent mis-deploys.
  const args = [...argv];
  const options = {
    target: null,
    skills: DEFAULT_SKILL_NAMES,
    destRoot: null,
    force: false,
    dryRun: false,
  };

  function takeOption(name) {
    // Options are always `--flag value` to keep parsing unambiguous.
    const index = args.indexOf(name);
    if (index === -1) return null;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    args.splice(index, 2);
    return value;
  }

  function takeFlag(name) {
    // Flags are booleans with no value component.
    const index = args.indexOf(name);
    if (index === -1) return false;
    args.splice(index, 1);
    return true;
  }

  if (takeFlag('--help')) {
    options.help = true;
    return options;
  }

  options.target = takeOption('--target');
  options.destRoot = takeOption('--dest-root');
  options.force = takeFlag('--force');
  options.dryRun = takeFlag('--dry-run');

  const skillsValue = takeOption('--skills');
  if (skillsValue) {
    const parsed = skillsValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    options.skills = parsed.length === 0 ? [] : parsed;
  }

  if (args.length > 0) {
    throw new Error(`Unknown arguments: ${args.join(' ')}`);
  }

  return options;
}

async function pathExists(path) {
  // `fs.stat` is enough here; we don't need to distinguish file vs directory.
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path, { dryRun }) {
  if (dryRun) return;
  await mkdir(path, { recursive: true });
}

async function listSkillDirs(rootDir) {
  // Skills are modeled as immediate subdirectories of `agent-skill/`.
  const entries = await readdir(rootDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function copySkillDir(fromDir, toDir, { dryRun, force }) {
  // Safety: overwrite is opt-in.
  // Rationale: user-level skill dirs are shared state across projects.
  if (await pathExists(toDir)) {
    if (!force) {
      throw new Error(`Destination exists: ${toDir} (use --force to overwrite)`);
    }
    if (dryRun) {
      logLine(`[dry-run] rm -rf ${toDir}`);
    }
    if (!dryRun) {
      await rm(toDir, { recursive: true, force: true });
    }
  }

  if (dryRun) {
    logLine(`[dry-run] cp -R ${fromDir} ${toDir}`);
    return;
  }
  await cp(fromDir, toDir, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
}

async function makeShebangFilesExecutable(dirPath, { dryRun }) {
  // Some filesystem copy strategies don't preserve mode bits (or consumers are
  // on platforms where exec bits are inconsistent). We defensively chmod any
  // script that looks like a shebang wrapper.
  const scriptsDir = join(dirPath, 'scripts');
  if (!(await pathExists(scriptsDir))) return;

  const entries = await readdir(scriptsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = join(scriptsDir, entry.name);

    try {
      // Our skill wrappers are simple shebang scripts (bash), which should be executable.
      // A defensive chmod keeps the deployed copy usable even if a platform drops mode bits.
      const head = (await readFile(filePath, 'utf8')).slice(0, 2);
      if (head !== '#!') continue;

      if (dryRun) continue;
      await chmod(filePath, 0o755);
    } catch {
      // Ignore chmod failures (ex: Windows); copy is still useful for consumers.
    }
  }
}

function defaultDestRootForTarget(target) {
  // Convention: Codex and Claude store user-installed skills in a dotfolder.
  // We allow overriding via `--dest-root` for nonstandard setups.
  const home = os.homedir();
  if (!home) throw new Error('Unable to resolve home directory (os.homedir() returned empty)');

  if (target === 'codex') return join(home, '.codex', 'skills');
  if (target === 'claude') return join(home, '.claude', 'skills');
  throw new Error(`Unknown target: ${target}`);
}

async function deployToRoot({ destRoot, skillNames, dryRun, force }) {
  // `destRoot/<skillName>/...` mirrors the in-repo `agent-skill/<skillName>/...`.
  logLine(`${dryRun ? '[dry-run] ' : ''}deploy -> ${destRoot}`);
  await ensureDir(destRoot, { dryRun });

  for (const skillName of skillNames) {
    const fromDir = join(SOURCE_SKILLS_DIR, skillName);
    const toDir = join(destRoot, skillName);

    if (!(await pathExists(fromDir))) {
      throw new Error(`Missing skill source: ${fromDir}`);
    }

    await copySkillDir(fromDir, toDir, { dryRun, force });
    await makeShebangFilesExecutable(toDir, { dryRun });
  }
}

async function main() {
  // This script assumes it runs from the repo root (npm does this by default).
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    logLine(usage());
    return;
  }

  if (!options.target) {
    throw new Error('Missing required flag: --target codex|claude|both');
  }

  if (!(await pathExists(SOURCE_SKILLS_DIR))) {
    throw new Error('Missing agent-skill/. Run from the repo root, or create the directory first.');
  }

  const allSkills = await listSkillDirs(SOURCE_SKILLS_DIR);
  if (allSkills.length === 0) {
    throw new Error('No skills found under agent-skill/.');
  }

  const skillNames = options.skills ?? allSkills;
  if (skillNames.length === 0) {
    throw new Error('No skills selected. Provide --skills <a,b,c> or omit to deploy all.');
  }

  const targets =
    options.target === 'both'
      ? ['codex', 'claude']
      : options.target === 'codex' || options.target === 'claude'
        ? [options.target]
        : (() => {
            throw new Error(`Invalid --target: ${options.target}`);
          })();

  for (const target of targets) {
    const destRoot = options.destRoot ?? defaultDestRootForTarget(target);
    await deployToRoot({ destRoot, skillNames, dryRun: options.dryRun, force: options.force });
  }
}

main().catch((error) => {
  // Use sync writes so error messages are reliably captured by callers.
  writeSync(2, `${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
