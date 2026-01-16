import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertSafeId } from './id.js';
export { assertSafeId } from './id.js';
/**
 * Compute a stable hex-encoded SHA-256 digest.
 *
 * Used as:
 * - an etag for optimistic concurrency checks
 * - a change detector for idempotent operations
 */
export function sha256Hex(text) {
    return createHash('sha256').update(text).digest('hex');
}
/**
 * Enforce that `absolutePath` does not escape `rootDir`.
 *
 * We intentionally check via `relative()` rather than string prefix matching to
 * handle path normalization correctly across platforms.
 *
 * Note: this is a lexical/path-traversal guard only. We intentionally do NOT
 * resolve symlinks (realpath), because users may place symlinks under `rootDir`
 * that point outside as an explicit workflow choice.
 */
function assertPathWithinRoot(rootDir, absolutePath) {
    const rel = relative(rootDir, absolutePath);
    if (rel === '' || rel === '.')
        return;
    // On Windows, `path.relative()` can return an absolute path if drives differ.
    if (isAbsolute(rel)) {
        throw new Error(`Resolved path escapes rootDir: ${absolutePath}`);
    }
    const parts = rel.split(sep);
    if (parts.includes('..')) {
        throw new Error(`Resolved path escapes rootDir: ${absolutePath}`);
    }
}
/**
 * Resolve the plans directory and ensure it is inside `rootDir`.
 */
export function resolvePlansDir(config) {
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
export function resolvePlanPath(config, planId) {
    assertSafeId('planId', planId);
    const plansDir = resolvePlansDir(config);
    const absolutePath = resolve(plansDir, `${planId}.md`);
    assertPathWithinRoot(resolve(config.rootDir), absolutePath);
    return absolutePath;
}
/**
 * Read a plan file and compute its etag.
 *
 * The etag is derived from file contents (not mtime) to support safe retries and
 * optimistic concurrency for edits.
 */
export async function readPlanFile(config, planId) {
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
export async function writeFileAtomic(absolutePath, text) {
    const dir = dirname(absolutePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${absolutePath}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, text, 'utf8');
    await rename(tmpPath, absolutePath);
}
/**
 * Write a file via a temporary path, but fail if the destination already exists.
 *
 * Used for create-only operations (ex: `plan.create`) where overwriting an
 * existing plan due to a race would be surprising.
 *
 * Implementation:
 * - Write a temp file in the same directory as the destination.
 * - Atomically `link()` it into place (fails with EEXIST if dest exists).
 * - Remove the temp path; the destination link remains.
 */
export async function writeFileAtomicExclusive(absolutePath, text) {
    const dir = dirname(absolutePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${absolutePath}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, text, 'utf8');
    try {
        await link(tmpPath, absolutePath);
    }
    finally {
        try {
            await rm(tmpPath, { force: true });
        }
        catch {
            // Ignore cleanup failures; the destination (if created) is the source of truth.
        }
    }
}
//# sourceMappingURL=storage.js.map