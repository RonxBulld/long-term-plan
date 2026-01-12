import type { TaskStatus } from './model.js';

/**
 * The set of allowed status symbols used in task list items.
 *
 * In markdown:
 * - ` ` (space) => todo
 * - `*`         => doing
 * - `√`         => done
 */
export type TaskStatusSymbol = ' ' | '*' | '√';

/**
 * Convert a normalized task status to its markdown symbol.
 */
export function statusToSymbol(status: TaskStatus): TaskStatusSymbol {
  if (status === 'todo') return ' ';
  if (status === 'doing') return '*';
  return '√';
}

/**
 * Convert a markdown status symbol into a normalized task status.
 */
export function symbolToStatus(symbol: TaskStatusSymbol): TaskStatus {
  if (symbol === ' ') return 'todo';
  if (symbol === '*') return 'doing';
  return 'done';
}
