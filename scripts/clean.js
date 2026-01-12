import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Build helper that removes the TypeScript output directory (`dist/`).
 *
 * Notes:
 * - Uses `force: true` to keep `npm run build` idempotent even if `dist/` is missing.
 * - Kept dependency-free because it runs in CI and local dev.
 */
rmSync(resolve('dist'), { recursive: true, force: true });
