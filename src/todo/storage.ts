import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { LongTermPlanConfig } from '../config.js';

export interface ReadPlanFileResult {
  absolutePath: string;
  text: string;
  etag: string;
}

export function assertSafeId(
  kind: 'planId' | 'taskId',
  value: string
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${kind}: ${JSON.stringify(value)}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function assertPathWithinRoot(rootDir: string, absolutePath: string): void {
  const rel = relative(rootDir, absolutePath);
  if (rel === '' || rel === '.') return;
  if (rel.startsWith('..') || rel.includes('..' + '/')) {
    throw new Error(`Resolved path escapes rootDir: ${absolutePath}`);
  }
}

export function resolvePlansDir(config: LongTermPlanConfig): string {
  const rootDir = resolve(config.rootDir);
  const plansDir = resolve(rootDir, config.plansDir);
  assertPathWithinRoot(rootDir, plansDir);
  return plansDir;
}

export function resolvePlanPath(
  config: LongTermPlanConfig,
  planId: string
): string {
  assertSafeId('planId', planId);
  const plansDir = resolvePlansDir(config);
  const absolutePath = resolve(plansDir, `${planId}.md`);
  assertPathWithinRoot(config.rootDir, absolutePath);
  return absolutePath;
}

export async function readPlanFile(
  config: LongTermPlanConfig,
  planId: string
): Promise<ReadPlanFileResult> {
  const absolutePath = resolvePlanPath(config, planId);
  const text = await readFile(absolutePath, 'utf8');
  return { absolutePath, text, etag: sha256Hex(text) };
}

export async function writeFileAtomic(
  absolutePath: string,
  text: string
): Promise<void> {
  const dir = dirname(absolutePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${absolutePath}.tmp.${randomUUID()}`;
  await writeFile(tmpPath, text, 'utf8');
  await rename(tmpPath, absolutePath);
}
