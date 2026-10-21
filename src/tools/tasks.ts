import { z } from "zod";
import { clean, defineTool, idSchema, limitSchema, pick, pickAll, type ToolContext } from "./helpers.js";

const TASK_LIST_FIELDS = ["id", "name", "project_id", "archived", "position", "created_at"] as const;
const TASK_FIELDS = [
  "id",
  "name",
  "description",
  "status",
  "project_id",
  "task_list_id",
  "assigned_id",
  "assigned_user_id",
  "due_on",
  "urgent",
  "user_id",
  "subtasks_count",
  "resolved_subtasks_count",
  "comments_count",
  "created_at",
  "updated_at",
] as const;
const SUBTASK_FIELDS = ["id", "name", "task_id", "resolved", "position", "created_at"] as const;
const COMMENT_FIELDS = ["id", "body", "user_id", "target_type", "target_id", "created_at"] as const;

/**
 * Redbooth task statuses. "resolved" = done, "rejected" = won't do, "hold" = on hold.
 */
const statusSchema = z.enum(["new", "open", "hold", "resolved", "rejected"]);
const dueOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Due date in YYYY-MM-DD format.");

export function registerTaskTools(ctx: ToolContext) {
  // ---------- Task lists ----------
  defineTool(
    ctx,
    "list_task_lists",
    {
      title: "List task lists",
      description: "List the task lists in a Redbooth project. A task must belong to a task list.",
      inputSchema: {
        project_id: idSchema("project"),
        archived: z.boolean().optional().describe("true = only archived lists, false = only active lists."),
        limit: limitSchema,
      },
    },
    async ({ project_id, archived, limit }) =>
      pickAll(await ctx.client.list<any>("/task_lists", { project_id, archived }, limit ?? 50), TASK_LIST_FIELDS),
  );

  defineTool(
    ctx,
    "create_task_list",
    {
      title: "Create task list",
      description: "Create a new task list in a Redbooth project.",
      write: true,
      inputSchema: {
        project_id: idSchema("project"),
        name: z.string().min(1).describe("Task list name."),
      },
    },
    async (args) => pick(await ctx.client.post<any>("/task_lists", args), TASK_LIST_FIELDS),
  );

  // ---------- Tasks ----------
  defineTool(
    ctx,
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List Redbooth tasks. Filter by project, task list, assignee and/or status. " +
        "Without filters returns tasks across all your projects.",
      inputSchema: {
        project_id: z.number().int().optional().describe("Only tasks in this project."),
        task_list_id: z.number().int().optional().describe("Only tasks in this task list."),
        assigned_user_id: z.number().int().optional().describe("Only tasks assigned to this user ID."),
        status: z
          .array(statusSchema)
          .optional()
          .describe('Only tasks with these statuses, e.g. ["new","open"] for unfinished tasks.'),
        limit: limitSchema,
      },
    },
    async ({ project_id, task_list_id, assigned_user_id, status, limit }) =>
      pickAll(
        await ctx.client.list<any>(
          "/tasks",
          { project_id, task_list_id, assigned_user_id, status },
          limit ?? 50,
        ),
        TASK_FIELDS,
      ),
  );

  defineTool(
    ctx,
    "get_task",
    {
      title: "Get task",
      description: "Get full details of a single Redbooth task.",
      inputSchema: { task_id: idSchema("task") },
    },
    async ({ task_id }) => pick(await ctx.client.get<any>(`/tasks/${task_id}`), TASK_FIELDS),
  );

  defineTool(
    ctx,
    "create_task",
    {
      title: "Create task",
      description:
        "Create a Redbooth task. Requires a project_id and a task_list_id (use list_task_lists to find one).",
      write: true,
      inputSchema: {
        project_id: idSchema("project"),
        task_list_id: idSchema("task list"),
        name: z.string().min(1).describe("Task title."),
        description: z.string().optional().describe("Task description."),
        assigned_user_id: z.number().int().optional().describe("User ID to assign the task to."),
        due_on: dueOnSchema.optional(),
        urgent: z.boolean().optional().describe("Mark the task as urgent."),
      },
    },
    async (args) => pick(await ctx.client.post<any>("/tasks", clean(args)), TASK_FIELDS),
  );

  defineTool(
    ctx,
    "update_task",
    {
      title: "Update task",
      description: "Update fields on an existing Redbooth task. Only the provided fields are changed.",
      write: true,
      inputSchema: {
        task_id: idSchema("task"),
        name: z.string().min(1).optional().describe("New title."),
        description: z.string().optional().describe("New description."),
        status: statusSchema.optional().describe('New status ("resolved" marks it done).'),
        assigned_user_id: z.number().int().optional().describe("Reassign to this user ID."),
        due_on: dueOnSchema.optional(),
        urgent: z.boolean().optional(),
        task_list_id: z.number().int().optional().describe("Move to another task list."),
      },
    },
    async ({ task_id, ...fields }) => pick(await ctx.client.put<any>(`/tasks/${task_id}`, clean(fields)), TASK_FIELDS),
  );

  defineTool(
    ctx,
    "complete_task",
    {
      title: "Complete task",
      description: "Mark a Redbooth task as resolved (done).",
      write: true,
      inputSchema: { task_id: idSchema("task") },
    },
    async ({ task_id }) => pick(await ctx.client.put<any>(`/tasks/${task_id}`, { status: "resolved" }), TASK_FIELDS),
  );

  // ---------- Subtasks ----------
  defineTool(
    ctx,
    "list_subtasks",
    {
      title: "List subtasks",
      description: "List the subtasks (checklist items) of a Redbooth task.",
      inputSchema: { task_id: idSchema("task"), limit: limitSchema },
    },
    async ({ task_id, limit }) =>
      pickAll(await ctx.client.list<any>("/subtasks", { task_id }, limit ?? 100), SUBTASK_FIELDS),
  );

  defineTool(
    ctx,
    "create_subtask",
    {
      title: "Create subtask",
      description: "Add a subtask (checklist item) to a Redbooth task.",
      write: true,
      inputSchema: {
        task_id: idSchema("task"),
        name: z.string().min(1).describe("Subtask text."),
      },
    },
    async (args) => pick(await ctx.client.post<any>("/subtasks", args), SUBTASK_FIELDS),
  );

  defineTool(
    ctx,
    "update_subtask",
    {
      title: "Update subtask",
      description: "Rename a subtask and/or mark it resolved/unresolved.",
      write: true,
      inputSchema: {
        subtask_id: idSchema("subtask"),
        name: z.string().min(1).optional(),
        resolved: z.boolean().optional().describe("true = checked off, false = reopen."),
      },
    },
    async ({ subtask_id, ...fields }) =>
      pick(await ctx.client.put<any>(`/subtasks/${subtask_id}`, clean(fields)), SUBTASK_FIELDS),
  );

  // ---------- Comments ----------
  defineTool(
    ctx,
    "list_comments",
    {
      title: "List comments",
      description: "List comments on a Redbooth task.",
      inputSchema: { task_id: idSchema("task"), limit: limitSchema },
    },
    async ({ task_id, limit }) =>
      pickAll(
        await ctx.client.list<any>("/comments", { target_type: "task", target_id: task_id }, limit ?? 50),
        COMMENT_FIELDS,
      ),
  );

  defineTool(
    ctx,
    "add_comment",
    {
      title: "Add comment",
      description: "Post a comment on a Redbooth task.",
      write: true,
      inputSchema: {
        task_id: idSchema("task"),
        body: z.string().min(1).describe("Comment text."),
      },
    },
    async ({ task_id, body }) =>
      pick(await ctx.client.post<any>("/comments", { target_type: "task", target_id: task_id, body }), COMMENT_FIELDS),
  );
}

export function registerRawTools(ctx: ToolContext) {
  defineTool(
    ctx,
    "redbooth_api_get",
    {
      title: "Raw Redbooth GET",
      description:
        "Escape hatch: perform a read-only GET against any Redbooth API v3 path (e.g. path '/notes' with " +
        "query {\"project_id\": 1}). Use only when no dedicated tool fits. Returns the raw JSON.",
      inputSchema: {
        path: z
          .string()
          .regex(/^\/[A-Za-z0-9_\-/]*$/, "Path must start with / and contain only path characters")
          .describe("API path relative to https://redbooth.com/api/3, e.g. '/conversations'."),
        query: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters, e.g. {\"project_id\": 123}."),
      },
    },
    async ({ path, query }) => ctx.client.get(path, query),
  );
}
