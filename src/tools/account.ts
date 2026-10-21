import { z } from "zod";
import { defineTool, idSchema, limitSchema, pick, pickAll, type ToolContext } from "./helpers.js";

const USER_FIELDS = ["id", "first_name", "last_name", "username", "email", "organization_ids", "time_zone"] as const;
const ORG_FIELDS = ["id", "name", "permalink", "created_at"] as const;
const PROJECT_FIELDS = [
  "id",
  "name",
  "description",
  "organization_id",
  "archived",
  "permalink",
  "created_at",
  "updated_at",
] as const;

export function registerAccountTools(ctx: ToolContext) {
  defineTool(
    ctx,
    "get_me",
    {
      title: "Get current user",
      description: "Get the authenticated Redbooth user (useful to find your own user ID).",
      inputSchema: {},
    },
    async () => pick(await ctx.client.get<any>("/me"), USER_FIELDS),
  );

  defineTool(
    ctx,
    "list_organizations",
    {
      title: "List organizations",
      description: "List Redbooth organizations the current user belongs to.",
      inputSchema: { limit: limitSchema },
    },
    async ({ limit }) => pickAll(await ctx.client.list<any>("/organizations", {}, limit ?? 50), ORG_FIELDS),
  );

  defineTool(
    ctx,
    "list_users",
    {
      title: "List users",
      description:
        "List Redbooth users visible to you. Use this to find user IDs for assigning tasks. " +
        "Optionally filter by organization or project.",
      inputSchema: {
        organization_id: z.number().int().optional().describe("Only users in this organization."),
        project_id: z.number().int().optional().describe("Only users in this project."),
        limit: limitSchema,
      },
    },
    async ({ organization_id, project_id, limit }) =>
      pickAll(await ctx.client.list<any>("/users", { organization_id, project_id }, limit ?? 50), USER_FIELDS),
  );
}

export function registerProjectTools(ctx: ToolContext) {
  defineTool(
    ctx,
    "list_projects",
    {
      title: "List projects",
      description: "List Redbooth projects (workspaces) you have access to.",
      inputSchema: {
        organization_id: z.number().int().optional().describe("Only projects in this organization."),
        archived: z.boolean().optional().describe("true = only archived, false = only active."),
        limit: limitSchema,
      },
    },
    async ({ organization_id, archived, limit }) =>
      pickAll(await ctx.client.list<any>("/projects", { organization_id, archived }, limit ?? 50), PROJECT_FIELDS),
  );

  defineTool(
    ctx,
    "get_project",
    {
      title: "Get project",
      description: "Get details of a single Redbooth project.",
      inputSchema: { project_id: idSchema("project") },
    },
    async ({ project_id }) => pick(await ctx.client.get<any>(`/projects/${project_id}`), PROJECT_FIELDS),
  );

  defineTool(
    ctx,
    "create_project",
    {
      title: "Create project",
      description: "Create a new Redbooth project in an organization.",
      write: true,
      inputSchema: {
        name: z.string().min(1).describe("Project name."),
        organization_id: z.number().int().describe("Organization to create the project in."),
        description: z.string().optional().describe("Optional project description."),
      },
    },
    async (args) => pick(await ctx.client.post<any>("/projects", args), PROJECT_FIELDS),
  );
}
