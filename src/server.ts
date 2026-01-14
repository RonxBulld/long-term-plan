import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import type { LongTermPlanConfig } from './config.js';
import {
  createPlan,
  getPlan,
  getTask,
  listPlans,
  planUpdate,
  repairPlanDoc,
  searchTasks,
  taskAdd,
  taskDelete,
  taskUpdate,
  validatePlanDoc,
} from './todo/api.js';

/**
 * MCP server entrypoint for long-term-plan tools.
 *
 * This module focuses on wiring: it translates MCP tool calls into the
 * underlying plan/task API functions in `src/todo/api.ts`.
 */
function registerPlanListTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `plan.list`.
   *
   * This is intentionally lightweight: it enumerates plans + stats only and
   * does not parse or return any blockquote bodies.
   */
  server.registerTool(
    'plan.list',
    {
      title: 'List plan files',
      description: 'List todo plan markdown files under the plans directory.',
      inputSchema: {
        query: z.string().optional(),
      },
      outputSchema: {
        plans: z.array(
          z.object({
            planId: z.string(),
            title: z.string(),
            path: z.string(),
            stats: z.object({
              total: z.number(),
              todo: z.number(),
              doing: z.number(),
              done: z.number(),
            }),
          })
        ),
      },
    },
    async ({ query }) => {
      const plans = await listPlans(config, { query });
      return {
        content: [{ type: 'text', text: JSON.stringify({ plans }, null, 2) }],
        structuredContent: { plans },
      };
    }
  );
}

function registerPlanGetTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `plan.get`.
   *
   * Bodies are opt-in via flags because many clients only need the task tree.
   */
  server.registerTool(
    'plan.get',
    {
      title: 'Get a plan',
      description:
        'Read and parse a plan markdown file. Returns tasks in tree or flat view; optional flags can include plan/task blockquote bodies.',
      inputSchema: {
        planId: z.string(),
        view: z.enum(['tree', 'flat']).optional(),
        includeTaskBodies: z.boolean().optional(),
        includePlanBody: z.boolean().optional(),
      },
      outputSchema: {
        plan: z.any(),
        etag: z.string(),
      },
    },
    async ({ planId, view, includeTaskBodies, includePlanBody }) => {
      const { plan, etag } = await getPlan(config, {
        planId,
        view,
        includeTaskBodies,
        includePlanBody,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ plan, etag }, null, 2) }],
        structuredContent: { plan, etag },
      };
    }
  );
}

function registerPlanCreateTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `plan.create`.
   *
   * A plan body (if provided) is stored as a top-level blockquote run after the
   * first H1 in the markdown file.
   */
  server.registerTool(
    'plan.create',
    {
      title: 'Create a new plan file',
      description: 'Create a new plan markdown file in the plans directory (optionally with a plan body).',
      inputSchema: {
        planId: z.string(),
        title: z.string(),
        template: z.enum(['empty', 'basic']).optional(),
        bodyMarkdown: z.string().optional(),
      },
      outputSchema: {
        planId: z.string(),
        path: z.string(),
      },
    },
    async ({ planId, title, template, bodyMarkdown }) => {
      const created = await createPlan(config, { planId, title, template, bodyMarkdown });
      return {
        content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
        structuredContent: created,
      };
    }
  );
}

function registerPlanUpdateTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `plan.update`.
   *
   * For safety in concurrent environments, clients should pass `ifMatch` (etag).
   */
  server.registerTool(
    'plan.update',
    {
      title: 'Update a plan',
      description:
        'Update a plan title and/or plan-level blockquote body. For safe writes in concurrent environments, pass ifMatch (etag).',
      inputSchema: z
        .object({
          planId: z.string(),
          title: z.string().optional(),
          bodyMarkdown: z.string().optional(),
          clearBody: z.boolean().optional(),
          ifMatch: z.string().optional(),
        })
        .refine((value) => !(value.bodyMarkdown !== undefined && value.clearBody), {
          message: 'bodyMarkdown cannot be combined with clearBody',
        })
        .refine((value) => value.title !== undefined || value.bodyMarkdown !== undefined || value.clearBody, {
          message: 'At least one of title, bodyMarkdown, or clearBody is required',
        }),
      outputSchema: {
        etag: z.string(),
      },
    },
    async ({ planId, title, bodyMarkdown, clearBody, ifMatch }) => {
      const { etag } = await planUpdate(config, { planId, title, bodyMarkdown, clearBody, ifMatch });
      return {
        content: [{ type: 'text', text: JSON.stringify({ etag }, null, 2) }],
        structuredContent: { etag },
      };
    }
  );
}

function registerPlanTools(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register all `plan.*` tools.
   *
   * Keeping registration in small functions helps enforce repository limits on
   * function size and makes schema changes easier to review.
   */
  registerPlanListTool(server, config);
  registerPlanGetTool(server, config);
  registerPlanCreateTool(server, config);
  registerPlanUpdateTool(server, config);
}

function registerTaskGetTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `task.get`.
   *
   * By default this includes the task body (decoded from its indented blockquote)
   * so agents can work with a single call.
   */
  server.registerTool(
    'task.get',
    {
      title: 'Get a task',
      description:
        'Get a task from a plan (optionally including its decoded blockquote body). If taskId is omitted, defaults to the first "doing" task; otherwise the first unfinished task.',
      inputSchema: {
        planId: z.string(),
        taskId: z.string().optional(),
        includeBody: z.boolean().optional(),
      },
      outputSchema: {
        task: z.any(),
        etag: z.string(),
      },
    },
    async ({ planId, taskId, includeBody }) => {
      const { task, etag } = await getTask(config, { planId, taskId, includeBody });
      return {
        content: [{ type: 'text', text: JSON.stringify({ task, etag }, null, 2) }],
        structuredContent: { task, etag },
      };
    }
  );
}

function registerTaskAddTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `task.add`.
   *
   * The task body is written as a blockquote indented under the task line.
   */
  server.registerTool(
    'task.add',
    {
      title: 'Add a task',
      description:
        'Add a task to a plan (optionally under a section, under a parent task, or before another task). Can also write a blockquote body.',
      inputSchema: z
        .object({
          planId: z.string(),
          title: z.string(),
          bodyMarkdown: z.string().optional(),
          status: z.enum(['todo', 'doing', 'done']).optional(),
          sectionPath: z.array(z.string()).optional(),
          parentTaskId: z.string().optional(),
          beforeTaskId: z.string().optional(),
          ifMatch: z.string().optional(),
        })
        .refine(
          (value) =>
            !(
              value.beforeTaskId &&
              (value.parentTaskId || (value.sectionPath && value.sectionPath.length > 0))
            ),
          { message: 'beforeTaskId cannot be combined with parentTaskId or sectionPath' }
        ),
      outputSchema: {
        taskId: z.string(),
        etag: z.string(),
      },
    },
    async ({ planId, title, bodyMarkdown, status, sectionPath, parentTaskId, beforeTaskId, ifMatch }) => {
      const { taskId, etag } = await taskAdd(config, {
        planId,
        title,
        bodyMarkdown,
        status,
        sectionPath,
        parentTaskId,
        beforeTaskId,
        ifMatch,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ taskId, etag }, null, 2) }],
        structuredContent: { taskId, etag },
      };
    }
  );
}

function registerTaskUpdateTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `task.update`.
   *
   * This tool supports updating status/title and also writing/clearing the
   * decoded task body (stored as an indented blockquote on disk).
   */
  server.registerTool(
    'task.update',
    {
      title: 'Update a task',
      description:
        'Update a task in-place (minimal diff). You can update status/title and/or its decoded bodyMarkdown (stored on disk as an indented blockquote). If taskId is omitted, you must set allowDefaultTarget=true and provide ifMatch; the server will target the current doing task, else the first unfinished task.',
      inputSchema: z
        .object({
          planId: z.string(),
          taskId: z.string().optional(),
          status: z.enum(['todo', 'doing', 'done']).optional(),
          title: z.string().optional(),
          bodyMarkdown: z.string().optional(),
          clearBody: z.boolean().optional(),
          allowDefaultTarget: z.boolean().optional(),
          ifMatch: z.string().optional(),
        })
        .refine((value) => !(value.bodyMarkdown !== undefined && value.clearBody), {
          message: 'bodyMarkdown cannot be combined with clearBody',
        })
        .refine(
          (value) =>
            value.status !== undefined ||
            value.title !== undefined ||
            value.bodyMarkdown !== undefined ||
            value.clearBody,
          {
            message: 'At least one of status, title, bodyMarkdown, or clearBody is required',
          }
        ),
      outputSchema: { etag: z.string(), taskId: z.string() },
    },
    async ({ planId, taskId, status, title, bodyMarkdown, clearBody, allowDefaultTarget, ifMatch }) => {
      const { taskId: resolvedTaskId, etag } = await taskUpdate(config, {
        planId,
        taskId,
        status,
        title,
        bodyMarkdown,
        clearBody,
        allowDefaultTarget,
        ifMatch,
      });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ taskId: resolvedTaskId, etag }, null, 2) },
        ],
        structuredContent: { taskId: resolvedTaskId, etag },
      };
    }
  );
}

function registerTaskDeleteTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `task.delete`.
   *
   * Deletion removes the entire indented task block (including any body).
   */
  server.registerTool(
    'task.delete',
    {
      title: 'Delete a task',
      description: 'Delete a task (and its indented block) from a plan.',
      inputSchema: {
        planId: z.string(),
        taskId: z.string(),
        ifMatch: z.string().optional(),
      },
      outputSchema: { etag: z.string() },
    },
    async ({ planId, taskId, ifMatch }) => {
      const { etag } = await taskDelete(config, { planId, taskId, ifMatch });
      return {
        content: [{ type: 'text', text: JSON.stringify({ etag }, null, 2) }],
        structuredContent: { etag },
      };
    }
  );
}

function registerTaskSearchTool(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register `task.search`.
   *
   * Search is title-only (case-insensitive) and returns a flat hit list.
   */
  server.registerTool(
    'task.search',
    {
      title: 'Search tasks',
      description: 'Search tasks by title substring (case-insensitive) within a plan.',
      inputSchema: {
        planId: z.string(),
        query: z.string(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      outputSchema: {
        hits: z.array(
          z.object({
            planId: z.string(),
            taskId: z.string(),
            title: z.string(),
            status: z.enum(['todo', 'doing', 'done']),
            sectionPath: z.array(z.string()),
          })
        ),
      },
    },
    async ({ planId, query, status, limit }) => {
      const hits = await searchTasks(config, { planId, query, status, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify({ hits }, null, 2) }],
        structuredContent: { hits },
      };
    }
  );
}

function registerTaskTools(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register all `task.*` tools.
   *
   * Grouped here so `createMcpServer()` stays small and easy to scan.
   */
  registerTaskGetTool(server, config);
  registerTaskAddTool(server, config);
  registerTaskUpdateTool(server, config);
  registerTaskDeleteTool(server, config);
  registerTaskSearchTool(server, config);
}

function registerValidateTool(server: McpServer, config: LongTermPlanConfig, name: string): void {
  /**
   * Register a validator tool (currently exposed as `doc.validate`).
   *
   * This is deliberately strict: any deviation from long-term-plan-md v1 format
   * returns machine-readable errors with line numbers when possible.
   */
  server.registerTool(
    name,
    {
      title: 'Validate plan docs',
      description: 'Validate a plan markdown file against long-term-plan-md v1 format.',
      inputSchema: {
        planId: z.string(),
      },
      outputSchema: {
        errors: z.array(
          z.object({
            code: z.string(),
            message: z.string(),
            line: z.number().int().nonnegative().optional(),
          })
        ),
        warnings: z.array(
          z.object({
            code: z.string(),
            message: z.string(),
            line: z.number().int().nonnegative().optional(),
          })
        ),
      },
    },
    async ({ planId }) => {
      const { errors, warnings } = await validatePlanDoc(config, { planId });
      return {
        content: [{ type: 'text', text: JSON.stringify({ errors, warnings }, null, 2) }],
        structuredContent: { errors, warnings },
      };
    }
  );
}

function registerRepairTool(server: McpServer, config: LongTermPlanConfig, name: string): void {
  /**
   * Register a repair tool (currently exposed as `doc.repair`).
   *
   * Repairs are explicit and action-scoped so callers can stay in control.
   */
  server.registerTool(
    name,
    {
      title: 'Repair plan docs',
      description:
        'Attempt a safe, explicit repair of a plan markdown file (e.g., add header, add missing ids).',
      inputSchema: {
        planId: z.string(),
        actions: z.array(z.enum(['addFormatHeader', 'addMissingIds'])),
        dryRun: z.boolean().optional(),
        ifMatch: z.string().optional(),
      },
      outputSchema: {
        etag: z.string(),
        applied: z.object({
          addFormatHeader: z.boolean(),
          addMissingIds: z.number(),
        }),
      },
    },
    async ({ planId, actions, dryRun, ifMatch }) => {
      const { etag, applied } = await repairPlanDoc(config, {
        planId,
        actions,
        dryRun,
        ifMatch,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ etag, applied }, null, 2) }],
        structuredContent: { etag, applied },
      };
    }
  );
}

function registerLegacyDocTools(server: McpServer, config: LongTermPlanConfig): void {
  /**
   * Register legacy `doc.*` tools.
   *
   * These remain supported for backwards compatibility with older agents.
   */
  registerValidateTool(server, config, 'doc.validate');
  registerRepairTool(server, config, 'doc.repair');
}

/**
 * Create an MCP server instance and register all tools.
 *
 * Tool naming convention:
 * - `plan.*` operates on plan documents (list/get/create/update).
 * - `task.*` operates on tasks within a plan.
 *
 * Compatibility:
 * - Legacy `doc.*` tools can be enabled via `config.exposeLegacyDocTools`.
 */
export function createMcpServer(config: LongTermPlanConfig): McpServer {
  const server = new McpServer({ name: 'long-term-plan-mcp', version: '0.1.0' });

  registerPlanTools(server, config);
  registerTaskTools(server, config);
  if (config.exposeLegacyDocTools) registerLegacyDocTools(server, config);

  return server;
}

/**
 * Connect the MCP server to stdio transport and start serving requests.
 *
 * This function does not return until the transport closes.
 */
export async function runStdioServer(config: LongTermPlanConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
