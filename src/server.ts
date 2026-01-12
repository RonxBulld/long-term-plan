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
  taskRename,
  taskSetStatus,
  validatePlanDoc,
} from './todo/api.js';

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
      description:
        'Read and parse a plan markdown file. Returns tasks in tree or flat view.',
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
        planId: z.string().optional(),
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
      description: 'Get a task by id from a plan.',
      inputSchema: {
        planId: z.string(),
        taskId: z.string(),
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
      description: 'Add a task to a plan (optionally under a section or parent task).',
      inputSchema: {
        planId: z.string(),
        title: z.string(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        sectionPath: z.array(z.string()).optional(),
        parentTaskId: z.string().optional(),
        ifMatch: z.string().optional(),
      },
      outputSchema: {
        taskId: z.string(),
        etag: z.string(),
      },
    },
    async ({ planId, title, status, sectionPath, parentTaskId, ifMatch }) => {
      const { taskId, etag } = await taskAdd(config, {
        planId,
        title,
        status,
        sectionPath,
        parentTaskId,
        ifMatch,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ taskId, etag }, null, 2) }],
        structuredContent: { taskId, etag },
      };
    }
  );

  server.registerTool(
    'task.setStatus',
    {
      title: 'Set task status',
      description: 'Update a task status in-place (minimal diff).',
      inputSchema: {
        planId: z.string(),
        taskId: z.string(),
        status: z.enum(['todo', 'doing', 'done']),
        ifMatch: z.string().optional(),
      },
      outputSchema: { etag: z.string() },
    },
    async ({ planId, taskId, status, ifMatch }) => {
      const { etag } = await taskSetStatus(config, { planId, taskId, status, ifMatch });
      return {
        content: [{ type: 'text', text: JSON.stringify({ etag }, null, 2) }],
        structuredContent: { etag },
      };
    }
  );

  server.registerTool(
    'task.rename',
    {
      title: 'Rename a task',
      description: 'Update a task title in-place (minimal diff).',
      inputSchema: {
        planId: z.string(),
        taskId: z.string(),
        title: z.string(),
        ifMatch: z.string().optional(),
      },
      outputSchema: { etag: z.string() },
    },
    async ({ planId, taskId, title, ifMatch }) => {
      const { etag } = await taskRename(config, { planId, taskId, title, ifMatch });
      return {
        content: [{ type: 'text', text: JSON.stringify({ etag }, null, 2) }],
        structuredContent: { etag },
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
      description: 'Search tasks by title substring (case-insensitive).',
      inputSchema: {
        query: z.string(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        planId: z.string().optional(),
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

  server.registerTool(
    'doc.validate',
    {
      title: 'Validate plan docs',
      description:
        'Validate a plan markdown file against long-term-plan-md v1 format. Returns diagnostics.',
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

  server.registerTool(
    'doc.repair',
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

  return server;
}

export async function runStdioServer(config: LongTermPlanConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
