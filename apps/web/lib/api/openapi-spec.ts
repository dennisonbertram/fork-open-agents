import { z } from "zod";
import {
  createBranchRequestSchema,
  commitChangesRequestSchema,
  mergePrRequestSchema,
  openPullRequestRequestSchema,
} from "@/lib/git/http-schemas";
import {
  createUserSkillInputSchema,
  updateUserSkillInputSchema,
} from "@/lib/skills/skill-types";

/**
 * Source of truth for the generated OpenAPI document. Built from the SAME Zod
 * schemas the routes validate against (zod 4 `toJSONSchema`), so the published
 * contract can't silently drift from the handlers. Seeded with the
 * strongly-typed resources (skills, git/GitHub); extend as routes adopt
 * explicit schemas.
 *
 * Regenerate the artifacts after changing this file:
 *   bun run --cwd apps/web openapi:generate && bun run --cwd apps/web openapi:types
 */

type JsonSchema = Record<string, unknown>;

// Request bodies use the INPUT shape (what a client sends, pre-transform);
// responses use the OUTPUT shape (what the server returns). This also lets
// schemas with `.transform()` (e.g. allowedTools trimming) serialize cleanly.
function j(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as JsonSchema;
}

// ---- response schemas (the routes return these shapes) --------------------

const userSkillSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  disableModelInvocation: z.boolean(),
  userInvocable: z.boolean(),
  allowedTools: z.array(z.string()),
  source: z.enum(["manual", "generated"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorSchema = z.object({ error: z.string() });
const gitStatusSchema = z
  .object({
    branch: z.string(),
    isDetachedHead: z.boolean(),
    hasUncommittedChanges: z.boolean(),
    hasUnpushedCommits: z.boolean(),
    stagedCount: z.number(),
    unstagedCount: z.number(),
    untrackedCount: z.number(),
    uncommittedFiles: z.number(),
  })
  .nullable();

const jsonBody = (schema: z.ZodType) => ({
  required: true,
  content: { "application/json": { schema: j(schema, "input") } },
});
const jsonResponse = (description: string, schema: z.ZodType) => ({
  description,
  content: { "application/json": { schema: j(schema, "output") } },
});
const errorResponse = (description: string) =>
  jsonResponse(description, errorSchema);

const sessionIdParam = {
  name: "sessionId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

export function buildOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Open Agents API",
      version: "0.1.0",
      description:
        "Typed contract for a vetted subset of the Open Agents HTTP API, generated from the route Zod schemas. All endpoints require an authenticated session.",
    },
    servers: [{ url: "/" }],
    paths: {
      "/api/settings/skills": {
        get: {
          operationId: "listSkills",
          summary: "List the current user's skills",
          responses: {
            "200": jsonResponse(
              "User skills",
              z.object({ skills: z.array(userSkillSchema) }),
            ),
            "401": errorResponse("Not authenticated"),
          },
        },
        post: {
          operationId: "createSkill",
          summary: "Create a skill",
          requestBody: jsonBody(createUserSkillInputSchema),
          responses: {
            "201": jsonResponse(
              "Created skill",
              z.object({ skill: userSkillSchema }),
            ),
            "400": errorResponse("Invalid payload"),
            "401": errorResponse("Not authenticated"),
            "409": errorResponse("Duplicate skill name"),
          },
        },
        patch: {
          operationId: "updateSkill",
          summary: "Update a skill",
          requestBody: jsonBody(updateUserSkillInputSchema),
          responses: {
            "200": jsonResponse(
              "Updated skill",
              z.object({ skill: userSkillSchema }),
            ),
            "400": errorResponse("Invalid payload"),
            "401": errorResponse("Not authenticated"),
            "404": errorResponse("Skill not found"),
            "409": errorResponse("Duplicate skill name"),
          },
        },
        delete: {
          operationId: "deleteSkill",
          summary: "Delete a skill",
          requestBody: jsonBody(z.object({ id: z.string() })),
          responses: {
            "200": jsonResponse("Deleted", z.object({ success: z.boolean() })),
            "401": errorResponse("Not authenticated"),
            "404": errorResponse("Skill not found"),
          },
        },
      },
      "/api/sessions/{sessionId}/git/status": {
        get: {
          operationId: "getGitStatus",
          summary: "Get the session's git status",
          parameters: [sessionIdParam],
          responses: {
            "200": jsonResponse(
              "Git status (null if unavailable)",
              z.object({ status: gitStatusSchema }),
            ),
            "401": errorResponse("Not authenticated"),
            "403": errorResponse("Forbidden"),
            "404": errorResponse("Session not found"),
            "409": errorResponse("Sandbox not initialized"),
          },
        },
      },
      "/api/sessions/{sessionId}/git/branch": {
        post: {
          operationId: "createBranch",
          summary: "Create a feature branch in the session sandbox",
          parameters: [sessionIdParam],
          requestBody: jsonBody(createBranchRequestSchema),
          responses: {
            "200": jsonResponse(
              "Resolved branch",
              z.object({ branchName: z.string() }),
            ),
            "400": errorResponse("Invalid payload"),
            "401": errorResponse("Not authenticated"),
            "403": errorResponse("Forbidden"),
            "404": errorResponse("Session not found"),
            "409": errorResponse("Sandbox not initialized"),
          },
        },
      },
      "/api/sessions/{sessionId}/git/commit": {
        post: {
          operationId: "commitChanges",
          summary: "Commit (and push) changes in the session sandbox",
          parameters: [sessionIdParam],
          requestBody: jsonBody(commitChangesRequestSchema),
          responses: {
            "200": jsonResponse(
              "Commit result",
              z.record(z.string(), z.unknown()),
            ),
            "400": errorResponse("Invalid payload"),
            "401": errorResponse("Not authenticated"),
            "403": errorResponse("Forbidden"),
            "404": errorResponse("Session not found"),
            "409": errorResponse("Sandbox not initialized"),
          },
        },
      },
      "/api/sessions/{sessionId}/git/pr": {
        get: {
          operationId: "checkPullRequest",
          summary: "Check the session's pull request status",
          parameters: [sessionIdParam],
          responses: {
            "200": jsonResponse(
              "PR status",
              z.object({
                branch: z.string().nullable(),
                prNumber: z.number().nullable(),
                prStatus: z.enum(["open", "merged", "closed"]).nullable(),
              }),
            ),
            "401": errorResponse("Not authenticated"),
            "403": errorResponse("Forbidden"),
            "404": errorResponse("Session not found"),
            "409": errorResponse("Sandbox not initialized"),
          },
        },
        post: {
          operationId: "openPullRequest",
          summary: "Open a pull request for the session branch",
          parameters: [sessionIdParam],
          requestBody: jsonBody(openPullRequestRequestSchema),
          responses: {
            "200": jsonResponse(
              "Open-PR result",
              z.record(z.string(), z.unknown()),
            ),
            "400": errorResponse("Invalid payload"),
            "401": errorResponse("Not authenticated"),
            "403": errorResponse("Forbidden"),
            "404": errorResponse("Session not found"),
            "409": errorResponse("Sandbox not initialized"),
          },
        },
      },
      "/api/sessions/{sessionId}/git/pr/merge": {
        post: {
          operationId: "mergePullRequest",
          summary: "Merge the session's pull request",
          parameters: [sessionIdParam],
          requestBody: jsonBody(mergePrRequestSchema),
          responses: {
            "200": jsonResponse(
              "Merge result",
              z.record(z.string(), z.unknown()),
            ),
            "400": errorResponse("Invalid payload"),
            "401": errorResponse("Not authenticated"),
            "403": errorResponse("Forbidden"),
            "404": errorResponse("Session not found"),
            "409": errorResponse("Sandbox not initialized"),
          },
        },
      },
    },
  };
}
