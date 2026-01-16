/**
 * Identifier rules shared across long-term-plan.
 *
 * We intentionally use the same "safe id" grammar for:
 * - `planId` (used in filenames: `<planId>.md`)
 * - `taskId` (stored in a trailing HTML comment: `<!-- long-term-plan:id=... -->`)
 *
 * Keeping this centralized avoids subtle mismatches where a document *parses*
 * but tasks cannot be targeted by APIs due to stricter runtime checks.
 */
/**
 * Safe identifier grammar (ASCII, stable, filesystem-friendly).
 *
 * Rules:
 * - 1..128 characters
 * - first char must be alphanumeric (avoid leading `_` / `-` ambiguity)
 * - remaining chars may include `_` and `-`
 */
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export function isSafeId(value) {
    return SAFE_ID_RE.test(value);
}
export function assertSafeId(kind, value) {
    if (!isSafeId(value)) {
        throw new Error(`Invalid ${kind}: ${JSON.stringify(value)}`);
    }
}
//# sourceMappingURL=id.js.map