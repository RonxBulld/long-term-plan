/**
 * Parsed representation of a long-term-plan markdown document.
 *
 * Notes:
 * - Line numbers are 0-based to match typical array indexing in JS/TS.
 * - `indent` is measured in leading spaces (tabs are not supported in task lines).
 */
export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Heading {
  /** Markdown heading level (1..6). */
  level: number;
  /** Raw heading text (trimmed). */
  text: string;
  /** 0-based line index where the heading appears. */
  line: number;
  /** Path of headings leading to this one (used for section addressing). */
  path: string[];
  /** Inclusive start line index for the heading's "section". */
  startLine: number;
  /** Inclusive end line index for the heading's "section". */
  endLine: number;
}

export interface TaskNode {
  /** Stable task identifier from the trailing HTML comment. */
  id: string;
  /** Task title text (without id trailer). */
  title: string;
  /** Normalized task status. */
  status: TaskStatus;
  /** True if the task has a structured blockquote body immediately after its task line. */
  hasBody: boolean;
  /** Optional decoded task body (raw Markdown, without `>` prefixes). */
  bodyMarkdown?: string;
  /** 0-based inclusive line range for the encoded body block (for minimal-diff edits). */
  bodyRange?: { startLine: number; endLine: number };
  /** Indent (leading spaces) used to infer parent/child relationships. */
  indent: number;
  /** 0-based line index where the task line starts. */
  line: number;
  /** Inclusive line index of the task "block" (task + indented children). */
  blockEndLine: number;
  /** Section path (headings) containing this task. */
  sectionPath: string[];
  /** Parent task id if the task is nested. */
  parentId?: string;
  /** Nested tasks (immediately indented under this task). */
  children: TaskNode[];
}

export interface ParsedPlan {
  /** Title derived from the first H1 heading (or a fallback). */
  title: string;
  /** True if the plan has a structured blockquote body under the first H1. */
  hasBody: boolean;
  /** Optional decoded plan body (raw Markdown, without `>` prefixes). */
  bodyMarkdown?: string;
  /** 0-based inclusive line range for the encoded plan body block (for minimal-diff edits). */
  bodyRange?: { startLine: number; endLine: number };
  /** All headings with computed section ranges. */
  headings: Heading[];
  /** Top-level tasks (not nested under another task). */
  rootTasks: TaskNode[];
  /** Fast lookup for tasks by id. */
  tasksById: Map<string, TaskNode>;
}
