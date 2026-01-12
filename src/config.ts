import { resolve } from 'node:path';
import { DEFAULT_PLANS_DIR } from './todo/constants.js';

/**
 * Runtime configuration for locating and managing plan markdown files.
 *
 * `rootDir` is treated as a trust boundary: plan paths must resolve within it.
 */
export interface LongTermPlanConfig {
  rootDir: string;
  plansDir: string;
}

/**
 * Parse CLI args into a `LongTermPlanConfig`.
 *
 * Supported flags:
 * - `--root <dir>`: filesystem root (defaults to `cwd`).
 * - `--plans <dir>`: plans directory relative to root (defaults to `.long-term-plan`).
 */
export function loadConfigFromArgs(
  argv: string[],
  cwd: string
): LongTermPlanConfig {
  const args = [...argv];

  let rootDir = cwd;
  let plansDir = DEFAULT_PLANS_DIR;

  while (args.length > 0) {
    const flag = args.shift();
    if (!flag) break;

    if (flag === '--root') {
      const value = args.shift();
      if (!value) throw new Error('Missing value for --root');
      rootDir = resolve(cwd, value);
      continue;
    }

    if (flag === '--plans') {
      const value = args.shift();
      if (!value) throw new Error('Missing value for --plans');
      plansDir = value;
      continue;
    }

    throw new Error(`Unknown argument: ${flag}`);
  }

  return { rootDir, plansDir };
}
