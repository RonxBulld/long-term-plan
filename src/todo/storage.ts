import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { LongTermPlanConfig } from '../config.js';

/**
 * Filesystem helpers for plan storage.
 *
 * Responsibilities:
 * - Normalize and validate ids and paths.
 * - Ensure all reads/writes stay within `config.rootDir`.
 * - Provide content hashing (etag) and atomic writes.
 */
export interface ReadPlanFileResult {
  absolutePath: string;
  text: string;
  etag: string;
}

/**
 * Validate a plan/task identifier.
 *
 * This is both a UX guard (consistent error messages) and a security boundary:
 * ids are later used to build file paths.
 */
export function assertSafeId(
  kind: 'planId' | 'taskId',
  value: string
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${kind}: ${JSON.stringify(value)}`);
  }
}

/**
 * Compute a stable hex-encoded SHA-256 digest.
 *
 * Used as:
 * - an etag for optimistic concurrency checks
 * - a change detector for idempotent operations
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Enforce that `absolutePath` does not escape `rootDir`.
 *
 * We intentionally check via `relative()` rather than string prefix matching to
 * handle path normalization correctly across platforms.
 */
function assertPathWithinRoot(rootDir: string, absolutePath: string): void {
  const rel = relative(rootDir, absolutePath);
  if (rel === '' || rel === '.') return;
  if (rel.startsWith('..') || rel.includes('..' + '/')) {
    throw new Error(`Resolved path escapes rootDir: ${absolutePath}`);
  }
}

/**
 * Resolve the plans directory and ensure it is inside `rootDir`.
 */
export function resolvePlansDir(config: LongTermPlanConfig): string {
  const rootDir = resolve(config.rootDir);
  const plansDir = resolve(rootDir, config.plansDir);
  assertPathWithinRoot(rootDir, plansDir);
  return plansDir;
}

/**
 * Resolve a plan markdown file path for a given plan id.
 *
 * The resulting path is validated to stay within `rootDir`.
 */
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

/**
 * Read a plan file and compute its etag.
 *
 * The etag is derived from file contents (not mtime) to support safe retries and
 * optimistic concurrency for edits.
 */
export async function readPlanFile(
  config: LongTermPlanConfig,
  planId: string
): Promise<ReadPlanFileResult> {
  const absolutePath = resolvePlanPath(config, planId);
  const text = await readFile(absolutePath, 'utf8');
  return { absolutePath, text, etag: sha256Hex(text) };
}

/**
 * Write a file via a temporary path and atomic rename.
 *
 * This pattern avoids torn writes and reduces the risk of leaving a partially
 * written plan document on disk.
 */
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
