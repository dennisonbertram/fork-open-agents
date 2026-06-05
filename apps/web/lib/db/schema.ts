import type { SandboxState } from "@open-agents/sandbox";
import type { ManagedRuntimeProfileCommand } from "@open-agents/sandbox/managed-runtime-profiles";
import type { SetupManagedRuntimeProfileInput } from "@open-agents/agent";
import type { ModelVariant } from "@/lib/model-variants";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";
import {
  type ChatComposioSelection,
  type ComposioAgentDefaults,
  type ComposioAgentKey,
  defaultChatComposioSelection,
  defaultComposioAgentDefaults,
} from "@/lib/composio/types";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type ManagedRuntimeCommandObservation = {
  commandId: string;
  label: string;
  status: "running" | "passed" | "failed" | "skipped";
  required?: boolean;
  exitCode?: number | null;
  durationMs?: number;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
};

export type ManagedRuntimeProfileDraftData =
  SetupManagedRuntimeProfileInput["draft"];

export type BackgroundAgentTriggerConditions = {
  actions?: string[];
  branches?: string[];
  labels?: string[];
  environments?: string[];
  severities?: string[];
};

export type BackgroundAgentPermissions = {
  github?: {
    contents?: "read" | "write";
    pullRequests?: "read" | "write";
    issues?: "read" | "write";
    deployments?: "read";
    statuses?: "read";
    checks?: "read";
  };
};

export type BackgroundAgentPayloadSummary = {
  title?: string;
  url?: string;
  actor?: string;
  action?: string;
  environment?: string;
  severity?: string;
  message?: string;
};

// users
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
});

// oauth provider accounts
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// better-auth sessions
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

// better-auth verification tokens
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: ["User", "Organization"],
    }).notNull(),
    repositorySelection: text("repository_selection", {
      enum: ["all", "selected"],
    }).notNull(),
    installationUrl: text("installation_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_installations_user_installation_idx").on(
      table.userId,
      table.installationId,
    ),
    uniqueIndex("github_installations_user_account_idx").on(
      table.userId,
      table.accountLogin,
    ),
  ],
);

export const vercelProjectLinks = pgTable(
  "vercel_project_links",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    projectId: text("project_id").notNull(),
    projectName: text("project_name").notNull(),
    teamId: text("team_id"),
    teamSlug: text("team_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.repoOwner, table.repoName],
    }),
  ],
);

export const inferenceProfiles = pgTable(
  "inference_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider", {
      enum: ["anthropic"],
    }).notNull(),
    baseUrl: text("base_url"),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    keyLast4: text("key_last4").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    status: text("status", {
      enum: ["untested", "verified", "failed"],
    })
      .notNull()
      .default("untested"),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestMessage: text("last_test_message"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("inference_profiles_user_idx").on(table.userId),
    uniqueIndex("inference_profiles_user_name_idx").on(
      table.userId,
      table.name,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "archived"],
    })
      .notNull()
      .default("running"),
    // Repository info
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    branch: text("branch"),
    cloneUrl: text("clone_url"),
    vercelProjectId: text("vercel_project_id"),
    vercelProjectName: text("vercel_project_name"),
    vercelTeamId: text("vercel_team_id"),
    vercelTeamSlug: text("vercel_team_slug"),
    // Whether this session uses a new auto-generated branch
    isNewBranch: boolean("is_new_branch").default(false).notNull(),
    // Optional per-session override for auto commit + push behavior.
    // null means "use the user's default preference".
    autoCommitPushOverride: boolean("auto_commit_push_override"),
    // Optional per-session override for auto PR creation after auto-commit.
    // null means "use the user's default preference".
    autoCreatePrOverride: boolean("auto_create_pr_override"),
    globalSkillRefs: jsonb("global_skill_refs")
      .$type<GlobalSkillRef[]>()
      .notNull()
      .default([]),
    // Unified sandbox state
    sandboxState: jsonb("sandbox_state").$type<SandboxState>(),
    runtimeMode: text("runtime_mode", {
      enum: ["classic", "managed_runtime"],
    })
      .notNull()
      .default("classic"),
    managedRuntimeProfileId: text("managed_runtime_profile_id")
      .notNull()
      .default("web-bun-agent-browser"),
    inferenceProfileId: text("inference_profile_id").references(
      () => inferenceProfiles.id,
      { onDelete: "set null" },
    ),
    // Lifecycle orchestration state for sandbox management
    lifecycleState: text("lifecycle_state", {
      enum: [
        "provisioning",
        "active",
        "hibernating",
        "hibernated",
        "restoring",
        "archived",
        "failed",
      ],
    }),
    lifecycleVersion: integer("lifecycle_version").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    sandboxExpiresAt: timestamp("sandbox_expires_at"),
    hibernateAfter: timestamp("hibernate_after"),
    lifecycleRunId: text("lifecycle_run_id"),
    lifecycleError: text("lifecycle_error"),
    // Git stats (for display in session list)
    linesAdded: integer("lines_added").default(0),
    linesRemoved: integer("lines_removed").default(0),
    // PR info if created
    prNumber: integer("pr_number"),
    prStatus: text("pr_status", {
      enum: ["open", "merged", "closed"],
    }),
    // Snapshot info (for cached snapshots feature)
    snapshotUrl: text("snapshot_url"),
    snapshotCreatedAt: timestamp("snapshot_created_at"),
    snapshotSizeBytes: integer("snapshot_size_bytes"),
    // Cached diff for offline viewing
    cachedDiff: jsonb("cached_diff"),
    cachedDiffUpdatedAt: timestamp("cached_diff_updated_at"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    modelId: text("model_id").default("anthropic/claude-haiku-4.5"),
    inferenceProfileId: text("inference_profile_id").references(
      () => inferenceProfiles.id,
      { onDelete: "set null" },
    ),
    composioSelection: jsonb("composio_selection")
      .$type<ChatComposioSelection>()
      .notNull()
      .default(defaultChatComposioSelection),
    activeStreamId: text("active_stream_id"),
    lastAssistantMessageAt: timestamp("last_assistant_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("chats_session_id_idx").on(table.sessionId)],
);

export const sandboxServices = pgTable(
  "sandbox_services",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["dev_server", "code_editor", "custom"],
    }).notNull(),
    status: text("status", {
      enum: ["stopped", "starting", "running", "failed", "stale"],
    }).notNull(),
    packageDir: text("package_dir"),
    command: text("command").notNull(),
    port: integer("port").notNull(),
    url: text("url"),
    pid: text("pid"),
    commandId: text("command_id"),
    logPath: text("log_path"),
    healthPath: text("health_path"),
    lastHealthStatus: integer("last_health_status"),
    lastStartedAt: timestamp("last_started_at"),
    lastSeenAt: timestamp("last_seen_at"),
    lastStoppedAt: timestamp("last_stopped_at"),
    relaunchOnResume: boolean("relaunch_on_resume").notNull().default(true),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("sandbox_services_session_kind_idx").on(table.sessionId, table.kind),
    index("sandbox_services_session_status_idx").on(
      table.sessionId,
      table.status,
    ),
    uniqueIndex("sandbox_services_session_kind_port_idx").on(
      table.sessionId,
      table.kind,
      table.port,
    ),
  ],
);

export const sandboxBrowserRuns = pgTable(
  "sandbox_browser_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    serviceId: text("service_id").references(() => sandboxServices.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["queued", "running", "passed", "failed"],
    }).notNull(),
    targetUrl: text("target_url").notNull(),
    summary: text("summary"),
    consoleErrors: jsonb("console_errors").notNull().default([]),
    networkErrors: jsonb("network_errors").notNull().default([]),
    steps: jsonb("steps").notNull().default([]),
    artifactRefs: jsonb("artifact_refs").notNull().default([]),
    redactionStatus: text("redaction_status", {
      enum: ["pending", "passed", "failed", "blocked"],
    })
      .notNull()
      .default("pending"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sandbox_browser_runs_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("sandbox_browser_runs_service_idx").on(table.serviceId),
  ],
);

export const managedRuntimeProfileRuns = pgTable(
  "managed_runtime_profile_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workflowRunId: text("workflow_run_id"),
    sandboxName: text("sandbox_name"),
    profileId: text("profile_id").notNull(),
    profileVersion: text("profile_version").notNull(),
    profileDisplayName: text("profile_display_name").notNull(),
    status: text("status", {
      enum: ["running", "passed", "failed", "blocked"],
    }).notNull(),
    expectedTools: jsonb("expected_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    optionalTools: jsonb("optional_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    setupResults: jsonb("setup_results")
      .$type<ManagedRuntimeCommandObservation[]>()
      .notNull()
      .default([]),
    verificationResults: jsonb("verification_results")
      .$type<ManagedRuntimeCommandObservation[]>()
      .notNull()
      .default([]),
    summary: text("summary"),
    failureMessage: text("failure_message"),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("managed_runtime_profile_runs_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("managed_runtime_profile_runs_workflow_idx").on(table.workflowRunId),
    index("managed_runtime_profile_runs_status_idx").on(table.status),
  ],
);

export const managedRuntimeSavedProfiles = pgTable(
  "managed_runtime_saved_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    sourceDraftId: text("source_draft_id"),
    scope: text("scope", {
      enum: ["session", "repo", "user_default"],
    })
      .notNull()
      .default("session"),
    version: text("version").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    setupCommands: jsonb("setup_commands")
      .$type<ManagedRuntimeProfileCommand[]>()
      .notNull()
      .default([]),
    verificationCommands: jsonb("verification_commands")
      .$type<ManagedRuntimeProfileCommand[]>()
      .notNull()
      .default([]),
    expectedTools: jsonb("expected_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    optionalTools: jsonb("optional_tools")
      .$type<string[]>()
      .notNull()
      .default([]),
    defaultPorts: jsonb("default_ports")
      .$type<number[]>()
      .notNull()
      .default([]),
    latestTestRunId: text("latest_test_run_id"),
    testResults: jsonb("test_results")
      .$type<ManagedRuntimeCommandObservation[]>()
      .notNull()
      .default([]),
    testFailureMessage: text("test_failure_message"),
    testedAt: timestamp("tested_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("managed_runtime_saved_profiles_user_idx").on(table.userId),
    index("managed_runtime_saved_profiles_session_idx").on(table.sessionId),
  ],
);

export const managedRuntimeProfileDrafts = pgTable(
  "managed_runtime_profile_drafts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    toolCallId: text("tool_call_id").notNull(),
    status: text("status", {
      enum: [
        "draft_ready",
        "testing",
        "tested",
        "needs_changes",
        "revision_requested",
        "approved",
        "applied",
        "discarded",
      ],
    })
      .notNull()
      .default("draft_ready"),
    targetScope: text("target_scope", {
      enum: ["session", "repo", "user_default"],
    })
      .notNull()
      .default("session"),
    goal: text("goal").notNull(),
    repoSignals: jsonb("repo_signals").$type<string[]>().notNull().default([]),
    profileDraft: jsonb("profile_draft")
      .$type<ManagedRuntimeProfileDraftData>()
      .notNull(),
    questionsForUser: jsonb("questions_for_user")
      .$type<string[]>()
      .notNull()
      .default([]),
    latestTestRunId: text("latest_test_run_id"),
    testResults: jsonb("test_results")
      .$type<ManagedRuntimeCommandObservation[]>()
      .notNull()
      .default([]),
    testFailureMessage: text("test_failure_message"),
    testedAt: timestamp("tested_at"),
    userInstructions: text("user_instructions"),
    userDecision: text("user_decision", {
      enum: ["approved", "revise", "discarded"],
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("managed_runtime_profile_drafts_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("managed_runtime_profile_drafts_chat_idx").on(table.chatId),
    uniqueIndex("managed_runtime_profile_drafts_tool_call_idx").on(
      table.sessionId,
      table.toolCallId,
    ),
  ],
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: [
        "chat",
        "workflow",
        "managed_runtime",
        "sandbox",
        "harness",
        "service",
        "browser",
        "github",
        "system",
      ],
    }).notNull(),
    actorType: text("actor_type", {
      enum: [
        "user",
        "coordinator",
        "worker",
        "sandbox",
        "harness",
        "browser",
        "github",
        "workflow",
        "system",
      ],
    }).notNull(),
    actorId: text("actor_id"),
    eventName: text("event_name").notNull(),
    status: text("status", {
      enum: [
        "started",
        "running",
        "succeeded",
        "failed",
        "blocked",
        "skipped",
        "info",
      ],
    }).notNull(),
    summary: text("summary"),
    requestId: text("request_id"),
    workflowRunId: text("workflow_run_id"),
    harnessRunId: text("harness_run_id"),
    sandboxName: text("sandbox_name"),
    managedRuntimeProfileRunId: text(
      "managed_runtime_profile_run_id",
    ).references(() => managedRuntimeProfileRuns.id, { onDelete: "set null" }),
    serviceId: text("service_id").references(() => sandboxServices.id, {
      onDelete: "set null",
    }),
    browserRunId: text("browser_run_id").references(
      () => sandboxBrowserRuns.id,
      {
        onDelete: "set null",
      },
    ),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    redactionStatus: text("redaction_status", {
      enum: ["not_required", "passed", "failed", "blocked"],
    })
      .notNull()
      .default("passed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("session_events_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("session_events_chat_created_idx").on(table.chatId, table.createdAt),
    index("session_events_workflow_idx").on(table.workflowRunId),
    index("session_events_request_idx").on(table.requestId),
    index("session_events_profile_run_idx").on(
      table.managedRuntimeProfileRunId,
    ),
    index("session_events_service_idx").on(table.serviceId),
    index("session_events_browser_run_idx").on(table.browserRunId),
  ],
);

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("shares_chat_id_idx").on(table.chatId)],
);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant"],
  }).notNull(),
  // Store the full message parts as JSON for flexibility
  parts: jsonb("parts").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatReads = pgTable(
  "chat_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chatId] }),
    index("chat_reads_chat_id_idx").on(table.chatId),
  ],
);

export const verifiedBuildRuns = pgTable(
  "verified_build_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    harnessRunId: text("harness_run_id").notNull().unique(),
    mode: text("mode", {
      enum: ["investigation", "verified_build"],
    }).notNull(),
    status: text("status").notNull(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id"),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    intentSummary: text("intent_summary"),
    selectionReason: text("selection_reason"),
    lastEventId: text("last_event_id"),
    lastEventName: text("last_event_name"),
    lastEventAt: timestamp("last_event_at"),
    planApprovalState: text("plan_approval_state", {
      enum: ["not_required", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("not_required"),
    pendingApprovalKind: text("pending_approval_kind"),
    finalReportArtifactId: text("final_report_artifact_id"),
    goNoGo: text("go_no_go", {
      enum: ["unknown", "go", "no_go"],
    })
      .notNull()
      .default("unknown"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("verified_build_runs_session_chat_idx").on(
      table.sessionId,
      table.chatId,
    ),
    index("verified_build_runs_user_status_idx").on(table.userId, table.status),
    index("verified_build_runs_harness_run_id_idx").on(table.harnessRunId),
    uniqueIndex("verified_build_runs_idempotency_idx").on(
      table.tenantId,
      table.projectId,
      table.actorId,
      table.idempotencyKey,
    ),
  ],
);

export const verifiedBuildEvents = pgTable(
  "verified_build_events",
  {
    id: text("id").primaryKey(),
    verifiedBuildRunId: text("verified_build_run_id")
      .notNull()
      .references(() => verifiedBuildRuns.id, { onDelete: "cascade" }),
    harnessEventId: text("harness_event_id").notNull(),
    eventName: text("event_name").notNull(),
    eventPayload: jsonb("event_payload").notNull(),
    eventAt: timestamp("event_at"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    requestId: text("request_id"),
  },
  (table) => [
    uniqueIndex("verified_build_events_run_event_idx").on(
      table.verifiedBuildRunId,
      table.harnessEventId,
    ),
    index("verified_build_events_run_received_idx").on(
      table.verifiedBuildRunId,
      table.receivedAt,
    ),
  ],
);

export const backgroundAgents = pgTable(
  "background_agents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["enabled", "disabled"],
    })
      .notNull()
      .default("disabled"),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    instructions: text("instructions").notNull(),
    permissions: jsonb("permissions")
      .$type<BackgroundAgentPermissions>()
      .notNull()
      .default({}),
    outputMode: text("output_mode", {
      enum: ["comment", "ready_pr", "issue", "notification", "none"],
    })
      .notNull()
      .default("none"),
    checkCommand: text("check_command"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agents_user_idx").on(table.userId),
    index("background_agents_repo_idx").on(table.repoOwner, table.repoName),
    index("background_agents_status_idx").on(table.status),
  ],
);

export const backgroundAgentTriggers = pgTable(
  "background_agent_triggers",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => backgroundAgents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: [
        "github.pull_request",
        "github.deployment_status",
        "github.issue",
        "schedule.cron",
        "webhook.error",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["enabled", "disabled"],
    })
      .notNull()
      .default("enabled"),
    conditions: jsonb("conditions")
      .$type<BackgroundAgentTriggerConditions>()
      .notNull()
      .default({}),
    schedule: text("schedule"),
    webhookPublicId: text("webhook_public_id"),
    webhookSecretHash: text("webhook_secret_hash"),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    lastSkipReason: text("last_skip_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agent_triggers_agent_idx").on(table.agentId),
    index("background_agent_triggers_user_kind_idx").on(
      table.userId,
      table.kind,
    ),
    uniqueIndex("background_agent_triggers_webhook_public_idx").on(
      table.webhookPublicId,
    ),
  ],
);

export const backgroundAgentToolGrants = pgTable(
  "background_agent_tool_grants",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => backgroundAgents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["composio"],
    }).notNull(),
    profileId: text("profile_id"),
    agentRole: text("agent_role", {
      enum: ["main", "explorer", "executor", "design"],
    }).notNull(),
    phase: text("phase", {
      enum: ["investigate", "mutate", "notify", "always"],
    }).notNull(),
    status: text("status", {
      enum: ["enabled", "disabled"],
    })
      .notNull()
      .default("disabled"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agent_tool_grants_agent_idx").on(table.agentId),
    index("background_agent_tool_grants_user_idx").on(table.userId),
  ],
);

export const backgroundAgentRuns = pgTable(
  "background_agent_runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").references(() => backgroundAgents.id, {
      onDelete: "set null",
    }),
    triggerId: text("trigger_id").references(() => backgroundAgentTriggers.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "skipped",
        "cancelled",
      ],
    }).notNull(),
    source: text("source", {
      enum: ["github", "schedule", "webhook"],
    }).notNull(),
    triggerKind: text("trigger_kind", {
      enum: [
        "github.pull_request",
        "github.deployment_status",
        "github.issue",
        "schedule.cron",
        "webhook.error",
      ],
    }).notNull(),
    externalId: text("external_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    ref: text("ref"),
    sha: text("sha"),
    branch: text("branch"),
    prNumber: integer("pr_number"),
    issueNumber: integer("issue_number"),
    deploymentUrl: text("deployment_url"),
    sandboxName: text("sandbox_name"),
    outputKind: text("output_kind", {
      enum: ["comment", "ready_pr", "issue", "notification", "none"],
    }),
    outputUrl: text("output_url"),
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    payloadSummary: jsonb("payload_summary")
      .$type<BackgroundAgentPayloadSummary>()
      .notNull()
      .default({}),
    resultSummary:
      jsonb("result_summary").$type<
        import("@/lib/background-agents/run-summary").RunSummary
      >(),
    requestId: text("request_id"),
    workflowRunId: text("workflow_run_id"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agent_runs_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    index("background_agent_runs_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("background_agent_runs_repo_created_idx").on(
      table.repoOwner,
      table.repoName,
      table.createdAt,
    ),
    uniqueIndex("background_agent_runs_idempotency_idx").on(
      table.idempotencyKey,
    ),
  ],
);

export const backgroundAgentEvents = pgTable(
  "background_agent_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backgroundAgentRuns.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => backgroundAgents.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    status: text("status", {
      enum: [
        "started",
        "running",
        "succeeded",
        "failed",
        "blocked",
        "skipped",
        "info",
      ],
    }).notNull(),
    level: text("level", {
      enum: ["info", "warn", "error"],
    })
      .notNull()
      .default("info"),
    summary: text("summary"),
    requestId: text("request_id"),
    workflowRunId: text("workflow_run_id"),
    sandboxName: text("sandbox_name"),
    errorKind: text("error_kind"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    redactionStatus: text("redaction_status", {
      enum: ["not_required", "passed", "failed", "blocked"],
    })
      .notNull()
      .default("passed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agent_events_run_created_idx").on(
      table.runId,
      table.createdAt,
    ),
    index("background_agent_events_request_idx").on(table.requestId),
  ],
);

export const backgroundAgentOutputs = pgTable(
  "background_agent_outputs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backgroundAgentRuns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["comment", "ready_pr", "issue", "notification", "none"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "created", "failed", "skipped"],
    }).notNull(),
    url: text("url"),
    prNumber: integer("pr_number"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agent_outputs_run_idx").on(table.runId),
    index("background_agent_outputs_user_idx").on(table.userId),
  ],
);

export const backgroundAgentToolSessions = pgTable(
  "background_agent_tool_sessions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backgroundAgentRuns.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => backgroundAgents.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["composio"],
    }).notNull(),
    profileId: text("profile_id"),
    agentRole: text("agent_role", {
      enum: ["main", "explorer", "executor", "design"],
    }).notNull(),
    phase: text("phase", {
      enum: ["investigate", "mutate", "notify", "always"],
    }).notNull(),
    providerSessionId: text("provider_session_id"),
    configHash: text("config_hash"),
    status: text("status", {
      enum: ["planned", "ready", "failed", "skipped"],
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  },
  (table) => [
    index("background_agent_tool_sessions_run_idx").on(table.runId),
    index("background_agent_tool_sessions_user_idx").on(table.userId),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: text("model_id"),
    inferenceRoute: text("inference_route", {
      enum: ["gateway", "user"],
    }),
    inferenceProfileId: text("inference_profile_id").references(
      () => inferenceProfiles.id,
      { onDelete: "set null" },
    ),
    requestId: text("request_id"),
    runtimeMode: text("runtime_mode", {
      enum: ["classic", "managed_runtime"],
    }),
    sandboxName: text("sandbox_name"),
    managedRuntimeProfileId: text("managed_runtime_profile_id"),
    managedRuntimeProfileVersion: text("managed_runtime_profile_version"),
    managedRuntimeProfileRunId: text(
      "managed_runtime_profile_run_id",
    ).references(() => managedRuntimeProfileRuns.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    status: text("status", {
      enum: ["completed", "aborted", "failed"],
    }).notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    totalDurationMs: integer("total_duration_ms").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_runs_chat_id_idx").on(table.chatId),
    index("workflow_runs_session_id_idx").on(table.sessionId),
    index("workflow_runs_user_id_idx").on(table.userId),
    index("workflow_runs_request_id_idx").on(table.requestId),
    index("workflow_runs_runtime_mode_idx").on(table.runtimeMode),
    index("workflow_runs_profile_run_idx").on(table.managedRuntimeProfileRunId),
  ],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    finishReason: text("finish_reason"),
    rawFinishReason: text("raw_finish_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_run_steps_run_id_idx").on(table.workflowRunId),
    uniqueIndex("workflow_run_steps_run_step_idx").on(
      table.workflowRunId,
      table.stepNumber,
    ),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type VercelProjectLink = typeof vercelProjectLinks.$inferSelect;
export type NewVercelProjectLink = typeof vercelProjectLinks.$inferInsert;
export type InferenceProfile = typeof inferenceProfiles.$inferSelect;
export type NewInferenceProfile = typeof inferenceProfiles.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type SandboxService = typeof sandboxServices.$inferSelect;
export type NewSandboxService = typeof sandboxServices.$inferInsert;
export type SandboxBrowserRun = typeof sandboxBrowserRuns.$inferSelect;
export type NewSandboxBrowserRun = typeof sandboxBrowserRuns.$inferInsert;
export type ManagedRuntimeProfileRun =
  typeof managedRuntimeProfileRuns.$inferSelect;
export type NewManagedRuntimeProfileRun =
  typeof managedRuntimeProfileRuns.$inferInsert;
export type ManagedRuntimeProfileDraft =
  typeof managedRuntimeProfileDrafts.$inferSelect;
export type NewManagedRuntimeProfileDraft =
  typeof managedRuntimeProfileDrafts.$inferInsert;
export type ManagedRuntimeSavedProfile =
  typeof managedRuntimeSavedProfiles.$inferSelect;
export type NewManagedRuntimeSavedProfile =
  typeof managedRuntimeSavedProfiles.$inferInsert;
export type SessionEvent = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;
export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatRead = typeof chatReads.$inferSelect;
export type NewChatRead = typeof chatReads.$inferInsert;
export type VerifiedBuildRun = typeof verifiedBuildRuns.$inferSelect;
export type NewVerifiedBuildRun = typeof verifiedBuildRuns.$inferInsert;
export type VerifiedBuildEvent = typeof verifiedBuildEvents.$inferSelect;
export type NewVerifiedBuildEvent = typeof verifiedBuildEvents.$inferInsert;
export type BackgroundAgent = typeof backgroundAgents.$inferSelect;
export type NewBackgroundAgent = typeof backgroundAgents.$inferInsert;
export type BackgroundAgentTrigger =
  typeof backgroundAgentTriggers.$inferSelect;
export type NewBackgroundAgentTrigger =
  typeof backgroundAgentTriggers.$inferInsert;
export type BackgroundAgentToolGrant =
  typeof backgroundAgentToolGrants.$inferSelect;
export type NewBackgroundAgentToolGrant =
  typeof backgroundAgentToolGrants.$inferInsert;
export type BackgroundAgentRun = typeof backgroundAgentRuns.$inferSelect;
export type NewBackgroundAgentRun = typeof backgroundAgentRuns.$inferInsert;
export type BackgroundAgentEvent = typeof backgroundAgentEvents.$inferSelect;
export type NewBackgroundAgentEvent = typeof backgroundAgentEvents.$inferInsert;
export type BackgroundAgentOutput = typeof backgroundAgentOutputs.$inferSelect;
export type NewBackgroundAgentOutput =
  typeof backgroundAgentOutputs.$inferInsert;
export type BackgroundAgentToolSession =
  typeof backgroundAgentToolSessions.$inferSelect;
export type NewBackgroundAgentToolSession =
  typeof backgroundAgentToolSessions.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type NewWorkflowRunStep = typeof workflowRunSteps.$inferInsert;

// ── Immutable workflow input snapshot (one per run, written at run-start) ──
// Stores validated input values with sensitive fields redacted as "[REDACTED]".
// See issue #46 for rationale (Option B — separate table, not columns on workflowRuns).
//
// FIX 2 (issue #46): The FK to workflow_runs.id has been intentionally dropped.
// The snapshot is persisted AFTER start(runAgentWorkflow, ...) using the REAL
// run.runId. Because workflow_runs rows are written at run-FINISH (via
// recordWorkflowRun), the parent row does not yet exist at persist time — a hard
// FK would cause a Postgres FK violation. The workflowRunId is kept as a plain
// indexed text column (application-level reference). ON DELETE CASCADE behavior
// is intentionally dropped; audit snapshots are retained even if the run row is
// cleaned up. App-level cleanup (e.g. cascade via scheduled job) is a follow-up.
export const workflowInputSnapshots = pgTable(
  "workflow_input_snapshots",
  {
    id: text("id").primaryKey(),
    // Plain text reference to the workflow run id (no FK — see note above).
    workflowRunId: text("workflow_run_id").notNull(),
    workflowId: text("workflow_id"),
    schemaVersion: text("schema_version"),
    // Validated input values; sensitive fields stored as "[REDACTED]" — never raw secrets.
    inputValues: jsonb("input_values")
      .$type<Record<string, unknown>>()
      .notNull(),
    persistedAt: timestamp("persisted_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_input_snapshots_run_id_idx").on(table.workflowRunId),
    uniqueIndex("workflow_input_snapshots_run_id_unique").on(
      table.workflowRunId,
    ),
  ],
);

export type WorkflowInputSnapshot = typeof workflowInputSnapshots.$inferSelect;
export type NewWorkflowInputSnapshot =
  typeof workflowInputSnapshots.$inferInsert;
export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallations.$inferInsert;

export const composioToolProfiles = pgTable(
  "composio_tool_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    toolkitSlugs: jsonb("toolkit_slugs").$type<string[]>().notNull(),
    authConfigIdsByToolkit: jsonb("auth_config_ids_by_toolkit")
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    connectedAccountIdsByToolkit: jsonb("connected_account_ids_by_toolkit")
      .$type<Record<string, string[]>>()
      .notNull()
      .default({}),
    workbenchEnabled: boolean("workbench_enabled").notNull().default(false),
    allowInChatConnectionManagement: boolean(
      "allow_in_chat_connection_management",
    )
      .notNull()
      .default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("composio_tool_profiles_user_idx").on(table.userId),
    uniqueIndex("composio_tool_profiles_user_name_idx").on(
      table.userId,
      table.name,
    ),
  ],
);

export const composioAgentSessions = pgTable(
  "composio_agent_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    agentKey: text("agent_key", {
      enum: ["main", "explorer", "executor", "design"],
    })
      .$type<ComposioAgentKey>()
      .notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => composioToolProfiles.id, { onDelete: "cascade" }),
    configHash: text("config_hash").notNull(),
    composioSessionId: text("composio_session_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  },
  (table) => [
    index("composio_agent_sessions_user_idx").on(table.userId),
    index("composio_agent_sessions_chat_idx").on(table.chatId),
    uniqueIndex("composio_agent_sessions_lookup_idx").on(
      table.userId,
      table.chatId,
      table.agentKey,
      table.profileId,
      table.configHash,
    ),
  ],
);

export const repositoryComposioSettings = pgTable(
  "repository_composio_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    inheritGlobalDefaults: boolean("inherit_global_defaults")
      .notNull()
      .default(true),
    allowedProfileIds: jsonb("allowed_profile_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    blockedToolkitSlugs: jsonb("blocked_toolkit_slugs")
      .$type<string[]>()
      .notNull()
      .default([]),
    agentDefaults: jsonb("agent_defaults")
      .$type<Partial<ComposioAgentDefaults>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("repository_composio_settings_user_idx").on(table.userId),
    uniqueIndex("repository_composio_settings_repo_idx").on(
      table.userId,
      table.repoOwner,
      table.repoName,
    ),
  ],
);

export type ComposioToolProfile = typeof composioToolProfiles.$inferSelect;
export type NewComposioToolProfile = typeof composioToolProfiles.$inferInsert;
export type ComposioAgentSession = typeof composioAgentSessions.$inferSelect;
export type NewComposioAgentSession = typeof composioAgentSessions.$inferInsert;
export type RepositoryComposioSettings =
  typeof repositoryComposioSettings.$inferSelect;
export type NewRepositoryComposioSettings =
  typeof repositoryComposioSettings.$inferInsert;

// User preferences for settings
export const userPreferences = pgTable("user_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultModelId: text("default_model_id").default(
    "anthropic/claude-haiku-4.5",
  ),
  defaultSubagentModelId: text("default_subagent_model_id"),
  defaultSandboxType: text("default_sandbox_type", {
    enum: ["vercel"],
  }).default("vercel"),
  defaultManagedRuntimeProfileId: text("default_managed_runtime_profile_id")
    .notNull()
    .default("web-bun-agent-browser"),
  defaultInferenceProfileId: text("default_inference_profile_id").references(
    () => inferenceProfiles.id,
    { onDelete: "set null" },
  ),
  defaultDiffMode: text("default_diff_mode", {
    enum: ["unified", "split"],
  }).default("unified"),
  autoCommitPush: boolean("auto_commit_push").notNull().default(false),
  autoCreatePr: boolean("auto_create_pr").notNull().default(false),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  alertSoundEnabled: boolean("alert_sound_enabled").notNull().default(true),
  publicUsageEnabled: boolean("public_usage_enabled").notNull().default(false),
  globalSkillRefs: jsonb("global_skill_refs")
    .$type<GlobalSkillRef[]>()
    .notNull()
    .default([]),
  modelVariants: jsonb("model_variants")
    .$type<ModelVariant[]>()
    .notNull()
    .default([]),
  enabledModelIds: jsonb("enabled_model_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  composioAgentDefaults: jsonb("composio_agent_defaults")
    .$type<ComposioAgentDefaults>()
    .notNull()
    .default(defaultComposioAgentDefaults),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

// Usage tracking — one row per assistant turn (append-only)
export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["web"] })
    .notNull()
    .default("web"),
  agentType: text("agent_type", { enum: ["main", "subagent"] })
    .notNull()
    .default("main"),
  provider: text("provider"),
  modelId: text("model_id"),
  inferenceRoute: text("inference_route", {
    enum: ["gateway", "user"],
  }),
  inferenceProfileId: text("inference_profile_id").references(
    () => inferenceProfiles.id,
    { onDelete: "set null" },
  ),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

// ---------------------------------------------------------------------------
// Goal ledger — issue #35
//
// Terminal statuses (complete, failed, canceled, archived) are statuses from
// which no further progression is expected. Transition-validity enforcement
// (preventing movement OUT of a terminal state) is deferred to issue #38.
// ---------------------------------------------------------------------------

export type WorkflowGoalPlan = {
  steps: string[];
};

export const workflowGoals = pgTable(
  "workflow_goals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // App-level reference only: goal rows are created at workflow start before
    // workflow_runs rows are persisted at finish, so this cannot be an FK.
    workflowRunId: text("workflow_run_id"),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    objective: text("objective").notNull(),
    // Status enum uses lowercase words to match existing codebase conventions
    // (e.g. backgroundAgentRuns uses "queued", "running", "succeeded" etc.)
    // Terminal statuses: complete, failed, canceled, archived
    status: text("status", {
      enum: [
        "draft",
        "planned",
        "running",
        "awaiting_input",
        "blocked",
        "validating",
        "complete",
        "failed",
        "canceled",
        "archived",
      ],
    })
      .notNull()
      .default("draft"),
    plan: jsonb("plan").$type<WorkflowGoalPlan>(),
    blockedReason: text("blocked_reason"),
    evidenceRefs: jsonb("evidence_refs")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_goals_user_created_idx").on(table.userId, table.createdAt),
    index("workflow_goals_workflow_run_idx").on(table.workflowRunId),
  ],
);

export const workflowGoalEvents = pgTable(
  "workflow_goal_events",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id")
      .notNull()
      .references(() => workflowGoals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workflow_goal_events_goal_seq_idx").on(
      table.goalId,
      table.sequence,
    ),
    index("workflow_goal_events_goal_created_idx").on(
      table.goalId,
      table.createdAt,
    ),
  ],
);

export type WorkflowGoal = typeof workflowGoals.$inferSelect;
export type NewWorkflowGoal = typeof workflowGoals.$inferInsert;
export type WorkflowGoalEvent = typeof workflowGoalEvents.$inferSelect;
export type NewWorkflowGoalEvent = typeof workflowGoalEvents.$inferInsert;
