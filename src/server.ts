import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import type { LongTermPlanConfig } from './config.js';
import {
  createPlan,
  getPlan,
  getTask,
  listPlans,
  repairPlanDoc,
  searchTasks,
  taskAdd,
  taskDelete,
  taskUpdate,
  validatePlanDoc,
} from './todo/api.js';

/**
 * Create an MCP server instance and register all tools.
 *
 * Tool naming convention:
 * - `plan.*` operates on plan documents (list/get/create).
 * - `task.*` operates on tasks within a plan.
 *
 * Compatibility:
 * - Legacy `doc.*` tools can be enabled via `config.exposeLegacyDocTools`.
 */
export function createMcpServer(config: LongTermPlanConfig): McpServer {
  const server = new McpServer({ name: 'long-term-plan-mcp', version: '0.1.0' });

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

  server.registerTool(
    'plan.get',
    {
      title: 'Get a plan',
      description: 'Read and parse a plan markdown file. Returns tasks in tree or flat view.',
      inputSchema: {
        planId: z.string(),
        view: z.enum(['tree', 'flat']).optional(),
      },
      outputSchema: {
        plan: z.any(),
        etag: z.string(),
      },
    },
    async ({ planId, view }) => {
      const { plan, etag } = await getPlan(config, { planId, view });
      return {
        content: [{ type: 'text', text: JSON.stringify({ plan, etag }, null, 2) }],
        structuredContent: { plan, etag },
      };
    }
  );

  server.registerTool(
    'plan.create',
    {
      title: 'Create a new plan file',
      description: 'Create a new plan markdown file in the plans directory.',
      inputSchema: {
        planId: z.string(),
        title: z.string(),
        template: z.enum(['empty', 'basic']).optional(),
      },
      outputSchema: {
        planId: z.string(),
        path: z.string(),
      },
    },
    async ({ planId, title, template }) => {
      const created = await createPlan(config, { planId, title, template });
      return {
        content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
        structuredContent: created,
      };
    }
  );

  server.registerTool(
    'task.get',
    {
      title: 'Get a task',
      description:
        'Get a task from a plan. If taskId is omitted, defaults to the first "doing" task; otherwise the first unfinished task.',
      inputSchema: {
        planId: z.string(),
        taskId: z.string().optional(),
      },
      outputSchema: {
        task: z.any(),
        etag: z.string(),
      },
    },
    async ({ planId, taskId }) => {
      const { task, etag } = await getTask(config, { planId, taskId });
      return {
        content: [{ type: 'text', text: JSON.stringify({ task, etag }, null, 2) }],
        structuredContent: { task, etag },
      };
    }
  );

  server.registerTool(
    'task.add',
    {
      title: 'Add a task',
      description: 'Add a task to a plan (optionally under a section, under a parent task, or before another task).',
      inputSchema: z
        .object({
          planId: z.string(),
          title: z.string(),
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
    async ({ planId, title, status, sectionPath, parentTaskId, beforeTaskId, ifMatch }) => {
      const { taskId, etag } = await taskAdd(config, {
        planId,
        title,
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

  server.registerTool(
    'task.update',
    {
      title: 'Update a task',
      description:
        'Update a task in-place (minimal diff). You can update status and/or title. If taskId is omitted, you must set allowDefaultTarget=true and provide ifMatch; the server will target the current doing task, else the first unfinished task.',
      inputSchema: z
        .object({
          planId: z.string(),
          taskId: z.string().optional(),
          status: z.enum(['todo', 'doing', 'done']).optional(),
          title: z.string().optional(),
          allowDefaultTarget: z.boolean().optional(),
          ifMatch: z.string().optional(),
        })
        .refine((value) => value.status !== undefined || value.title !== undefined, {
          message: 'At least one of status or title is required',
        }),
      outputSchema: { etag: z.string(), taskId: z.string() },
    },
    async ({ planId, taskId, status, title, allowDefaultTarget, ifMatch }) => {
      const { taskId: resolvedTaskId, etag } = await taskUpdate(config, {
        planId,
        taskId,
        status,
        title,
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
    async ({ query, status, planId, limit }) => {
      const hits = await searchTasks(config, { query, status, planId, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify({ hits }, null, 2) }],
        structuredContent: { hits },
      };
    }
  );

  function registerValidateTool(name: string): void {
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

  function registerRepairTool(name: string): void {
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

  if (config.exposeLegacyDocTools) {
    registerValidateTool('doc.validate');
    registerRepairTool('doc.repair');
  }

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
