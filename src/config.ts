import { resolve } from 'node:path';
import { DEFAULT_PLANS_DIR } from './todo/constants.js';

export interface LongTermPlanConfig {
  rootDir: string;
  plansDir: string;
}

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
