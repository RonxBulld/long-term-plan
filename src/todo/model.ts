export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Heading {
  level: number; // 1..6
  text: string;
  line: number; // 0-based
  path: string[];
  startLine: number; // inclusive
  endLine: number; // inclusive
}

export interface TaskNode {
  id: string;
  title: string;
  status: TaskStatus;
  indent: number; // leading spaces
  line: number; // 0-based
  blockEndLine: number; // inclusive
  sectionPath: string[];
  parentId?: string;
  children: TaskNode[];
}

export interface ParsedPlan {
  title: string;
  headings: Heading[];
  rootTasks: TaskNode[];
  tasksById: Map<string, TaskNode>;
}

