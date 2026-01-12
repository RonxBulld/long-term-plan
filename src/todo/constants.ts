/**
 * Long-term-plan markdown format constants.
 *
 * These values define the "wire format" of plan documents:
 * - A required format header (used for detection/versioning).
 * - A stable task id key stored in an HTML comment trailer.
 */
export const LONG_TERM_PLAN_FORMAT_HEADER =
  '<!-- long-term-plan:format=v1 -->';

/**
 * The key used inside the task id trailer HTML comment.
 *
 * Example trailer:
 * `<!-- long-term-plan:id=t_abc123 -->`
 */
export const LONG_TERM_PLAN_TASK_ID_KEY = 'long-term-plan:id';

/**
 * Default directory (relative to `rootDir`) where plan markdown files live.
 */
export const DEFAULT_PLANS_DIR = '.long-term-plan';
