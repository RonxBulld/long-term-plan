import type { TaskStatus } from './model.js';

export type TaskStatusSymbol = ' ' | '*' | '√';

export function statusToSymbol(status: TaskStatus): TaskStatusSymbol {
  if (status === 'todo') return ' ';
  if (status === 'doing') return '*';
  return '√';
}

export function symbolToStatus(symbol: TaskStatusSymbol): TaskStatus {
  if (symbol === ' ') return 'todo';
  if (symbol === '*') return 'doing';
  return 'done';
}

