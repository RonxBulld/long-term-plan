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

const DEFAULT_ACTIVE_PLAN_ID = 'active-plan';
const DEFAULT_ACTIVE_PLAN_TITLE = 'Active Plan';

/**
 * Create an MCP server instance and register all tools.
 *
 * Tool naming convention:
 * - `plan.*` operates on plan documents (list/get/create).
 * - `task.*` operates on tasks within a plan.
 * - `doc.*` validates/repairs raw markdown.
 *
 * Default plan behavior:
 * - If callers omit `planId`, we treat `active-plan` as the implicit target.
 * - If the plan file is missing, we lazily create it and retry.
 */
export function createMcpServer(config: LongTermPlanConfig): McpServer {
  const server = new McpServer({ name: 'long-term-plan-mcp', version: '0.1.0' });

  /**
   * Detect ENOENT without being strict about the specific error type.
   * This is used to trigger "create default plan on demand" behavior.
   */
  function isEnoent(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
  }

  /**
   * Ensure the default plan exists.
   *
   * The tool layer uses this as a best-effort bootstrap when users query the
   * default plan without having created one yet.
   */
  async function ensureActivePlanExists(): Promise<void> {
    try {
      await createPlan(config, {
        planId: DEFAULT_ACTIVE_PLAN_ID,
        title: DEFAULT_ACTIVE_PLAN_TITLE,
        template: 'basic',
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Plan already exists:')) {
        return;
      }
      throw error;
    }
  }

  /**
   * Wrap tool handlers so they can accept optional `planId`.
   *
   * When `planId` is omitted, we:
   * - Use the default plan id.
   * - Auto-create the plan if the file is missing (ENOENT), then retry once.
   */
  async function withDefaultPlanId<T>(
    planId: string | undefined,
    fn: (resolvedPlanId: string) => Promise<T>
  ): Promise<T> {
    const resolvedPlanId = planId ?? DEFAULT_ACTIVE_PLAN_ID;
    try {
      return await fn(resolvedPlanId);
    } catch (error) {
      if (planId === undefined && isEnoent(error)) {
        await ensureActivePlanExists();
        return await fn(resolvedPlanId);
      }
      throw error;
    }
  }

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
        `Read and parse a plan markdown file. Returns tasks in tree or flat view. If planId is omitted, defaults to "${DEFAULT_ACTIVE_PLAN_ID}".`,
      inputSchema: {
        planId: z.string().optional(),
        view: z.enum(['tree', 'flat']).optional(),
      },
      outputSchema: {
        plan: z.any(),
        etag: z.string(),
      },
    },
    async ({ planId, view }) => {
      const { plan, etag } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        getPlan(config, { planId: resolvedPlanId, view })
      );
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
      description: `Get a task from a plan. If planId is omitted, defaults to "${DEFAULT_ACTIVE_PLAN_ID}". If taskId is omitted, defaults to the first "doing" task; otherwise the first unfinished task.`,
      inputSchema: {
        planId: z.string().optional(),
        taskId: z.string().optional(),
      },
      outputSchema: {
        task: z.any(),
        etag: z.string(),
      },
    },
    async ({ planId, taskId }) => {
      const { task, etag } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        getTask(config, { planId: resolvedPlanId, taskId })
      );
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
      description: `Add a task to a plan (optionally under a section or parent task). If planId is omitted, defaults to "${DEFAULT_ACTIVE_PLAN_ID}".`,
      inputSchema: {
        planId: z.string().optional(),
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
      const { taskId, etag } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        taskAdd(config, {
          planId: resolvedPlanId,
          title,
          status,
          sectionPath,
          parentTaskId,
          ifMatch,
        })
      );
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
      description:
        'Update a task status in-place (minimal diff). If taskId is omitted, you must set allowDefaultTarget=true and provide ifMatch; the server will target the current doing task, else the first unfinished task.',
      inputSchema: {
        planId: z.string().optional(),
        taskId: z.string().optional(),
        status: z.enum(['todo', 'doing', 'done']),
        allowDefaultTarget: z.boolean().optional(),
        ifMatch: z.string().optional(),
      },
      outputSchema: { etag: z.string(), taskId: z.string().optional() },
    },
    async ({ planId, taskId, status, allowDefaultTarget, ifMatch }) => {
      const { taskId: resolvedTaskId, etag } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        taskSetStatus(config, {
          planId: resolvedPlanId,
          taskId,
          status,
          allowDefaultTarget,
          ifMatch,
        })
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ taskId: resolvedTaskId, etag }, null, 2) }],
        structuredContent: { taskId: resolvedTaskId, etag },
      };
    }
  );

  server.registerTool(
    'task.rename',
    {
      title: 'Rename a task',
      description:
        'Update a task title in-place (minimal diff). If taskId is omitted, you must set allowDefaultTarget=true and provide ifMatch; the server will target the current doing task, else the first unfinished task.',
      inputSchema: {
        planId: z.string().optional(),
        taskId: z.string().optional(),
        title: z.string(),
        allowDefaultTarget: z.boolean().optional(),
        ifMatch: z.string().optional(),
      },
      outputSchema: { etag: z.string(), taskId: z.string().optional() },
    },
    async ({ planId, taskId, title, allowDefaultTarget, ifMatch }) => {
      const { taskId: resolvedTaskId, etag } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        taskRename(config, {
          planId: resolvedPlanId,
          taskId,
          title,
          allowDefaultTarget,
          ifMatch,
        })
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ taskId: resolvedTaskId, etag }, null, 2) }],
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
        planId: z.string().optional(),
        taskId: z.string(),
        ifMatch: z.string().optional(),
      },
      outputSchema: { etag: z.string() },
    },
    async ({ planId, taskId, ifMatch }) => {
      const { etag } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        taskDelete(config, { planId: resolvedPlanId, taskId, ifMatch })
      );
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
        `Validate a plan markdown file against long-term-plan-md v1 format. Returns diagnostics. If planId is omitted, defaults to "${DEFAULT_ACTIVE_PLAN_ID}".`,
      inputSchema: {
        planId: z.string().optional(),
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
      const { errors, warnings } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        validatePlanDoc(config, { planId: resolvedPlanId })
      );
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
        `Attempt a safe, explicit repair of a plan markdown file (e.g., add header, add missing ids). If planId is omitted, defaults to "${DEFAULT_ACTIVE_PLAN_ID}".`,
      inputSchema: {
        planId: z.string().optional(),
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
      const { etag, applied } = await withDefaultPlanId(planId, (resolvedPlanId) =>
        repairPlanDoc(config, {
          planId: resolvedPlanId,
          actions,
          dryRun,
          ifMatch,
        })
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ etag, applied }, null, 2) }],
        structuredContent: { etag, applied },
      };
    }
  );

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
