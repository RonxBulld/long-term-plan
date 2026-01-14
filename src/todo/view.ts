import type { TaskNode, TaskStatus } from './model.js';

/**
 * View/presentation helpers for todo plans.
 *
 * The core parser/edit model (`TaskNode`) includes line/indent metadata needed for safe minimal-diff
 * edits. Tool/CLI output should not expose that metadata, so these helpers translate tasks into
 * stable JSON shapes.
 *
 * Notes:
 * - Uses explicit stacks to avoid recursion depth issues on deeply nested plans.
 * - Includes `hasBody` always; includes `bodyMarkdown` only when explicitly requested.
 */

export type TaskTreeViewNode = {
  id: string;
  title: string;
  status: TaskStatus;
  sectionPath: string[];
  parentId?: string;
  hasBody: boolean;
  bodyMarkdown?: string;
  children: TaskTreeViewNode[];
};

export type TaskFlatRow = {
  id: string;
  title: string;
  status: TaskStatus;
  sectionPath: string[];
  parentId?: string;
  hasBody: boolean;
  bodyMarkdown?: string;
};

/**
 * Convert parsed tasks into a stable, minimal output shape for `plan.get (tree)`.
 */
export function buildTaskTreeView(
  rootTasks: TaskNode[],
  options: { includeBody: boolean }
): TaskTreeViewNode[] {
  const out: TaskTreeViewNode[] = [];
  const stack: { task: TaskNode; outArray: TaskTreeViewNode[] }[] = [];

  // Seed the stack in reverse so we push into `out` in the original order.
  for (let index = rootTasks.length - 1; index >= 0; index -= 1) {
    const task = rootTasks[index];
    if (!task) continue;
    stack.push({ task, outArray: out });
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;

    const task = frame.task;
    const node: TaskTreeViewNode = {
      id: task.id,
      title: task.title,
      status: task.status,
      sectionPath: task.sectionPath,
      parentId: task.parentId,
      hasBody: task.hasBody,
      children: [],
    };
    if (options.includeBody && task.hasBody) node.bodyMarkdown = task.bodyMarkdown;

    frame.outArray.push(node);

    // Push children in reverse so traversal preserves the original order.
    for (let index = task.children.length - 1; index >= 0; index -= 1) {
      const child = task.children[index];
      if (!child) continue;
      stack.push({ task: child, outArray: node.children });
    }
  }

  return out;
}

export function toTaskFlatRow(task: TaskNode, options: { includeBody: boolean }): TaskFlatRow {
  const row: TaskFlatRow = {
    id: task.id,
    title: task.title,
    status: task.status,
    sectionPath: task.sectionPath,
    parentId: task.parentId,
    hasBody: task.hasBody,
  };
  if (options.includeBody && task.hasBody) row.bodyMarkdown = task.bodyMarkdown;
  return row;
}

