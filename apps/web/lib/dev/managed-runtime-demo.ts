import path from "node:path";
import { connectSandbox, type SandboxState } from "@open-agents/sandbox";
import { DEFAULT_MANAGED_RUNTIME_PROFILE_ID } from "@open-agents/sandbox/managed-runtime-profiles";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, sessions, users } from "@/lib/db/schema";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import { getSessionSandboxName } from "@/lib/sandbox/utils";
import { TEST_AUTH_USER_ID } from "@/lib/session/test-auth";

export const MANAGED_RUNTIME_DEMO_SESSION_ID = "managed-runtime-demo-session";
export const MANAGED_RUNTIME_DEMO_CHAT_ID = "managed-runtime-demo-chat";

export type PrepareManagedRuntimeDemoOptions = {
  /**
   * Runtime mode to seed the demo session with. Defaults to
   * "managed_runtime" so the route named "managed-runtime-demo" actually
   * demos the managed runtime path (#816). Callers that still need the
   * legacy classic-mode demo can pass "classic" explicitly.
   */
  runtimeMode?: "classic" | "managed_runtime";
  /**
   * Managed runtime profile id to seed when runtimeMode is
   * "managed_runtime". Defaults to the built-in web-bun-agent-browser
   * profile; accepts a user_default profile id for callers that want to
   * demo a saved profile.
   */
  profileId?: string;
};

const DEMO_PACKAGE_JSON = JSON.stringify(
  {
    scripts: {
      dev: "vite",
    },
    dependencies: {
      "@vitejs/plugin-react": "latest",
      vite: "latest",
      react: "latest",
      "react-dom": "latest",
    },
    devDependencies: {},
  },
  null,
  2,
);

const DEMO_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Managed Runtime Demo</title>
  </head>
  <body>
    <main id="root"></main>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

const DEMO_VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
  },
});
`;

const DEMO_MAIN = `import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <section className="shell">
      <p className="eyebrow">Open Agents sandbox preview</p>
      <h1>Managed runtime demo is live.</h1>
      <p className="copy">
        This app is running inside a sandbox service launched from the
        opt-in managed runtime.
      </p>
      <div className="panel">
        <span>Service logs</span>
        <strong>captured</strong>
      </div>
      <div className="panel">
        <span>Browser check</span>
        <strong>ready</strong>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`;

const DEMO_STYLES = `:root {
  color: #111827;
  background: #f6f7fb;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

body {
  margin: 0;
}

.shell {
  min-height: 100vh;
  display: grid;
  align-content: center;
  gap: 18px;
  padding: 48px;
  box-sizing: border-box;
}

.eyebrow {
  margin: 0;
  color: #2563eb;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
}

h1 {
  max-width: 760px;
  margin: 0;
  font-size: 56px;
  line-height: 1;
}

.copy {
  max-width: 640px;
  margin: 0 0 12px;
  color: #4b5563;
  font-size: 20px;
  line-height: 1.5;
}

.panel {
  width: min(420px, 100%);
  display: flex;
  justify-content: space-between;
  gap: 24px;
  border: 1px solid #d7dce7;
  border-radius: 8px;
  background: #ffffff;
  padding: 16px 18px;
  box-sizing: border-box;
}

.panel span {
  color: #6b7280;
}

.panel strong {
  color: #047857;
}
`;

async function seedDemoRecords(
  options: Required<PrepareManagedRuntimeDemoOptions>,
): Promise<void> {
  const now = new Date();
  const { runtimeMode, profileId } = options;

  await db
    .insert(users)
    .values({
      id: TEST_AUTH_USER_ID,
      username: "managed-runtime-demo",
      email: "managed-runtime-demo@example.test",
      emailVerified: true,
      name: "Managed Runtime Demo",
      avatarUrl: null,
      isAdmin: false,
      lastLoginAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        username: "managed-runtime-demo",
        email: "managed-runtime-demo@example.test",
        name: "Managed Runtime Demo",
        lastLoginAt: now,
        updatedAt: now,
      },
    });

  await db
    .insert(sessions)
    .values({
      id: MANAGED_RUNTIME_DEMO_SESSION_ID,
      userId: TEST_AUTH_USER_ID,
      title: "Managed Runtime Demo",
      status: "running",
      sandboxState: { type: "vercel" },
      runtimeMode,
      managedRuntimeProfileId: profileId,
      lifecycleState: "provisioning",
      lifecycleVersion: 0,
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        title: "Managed Runtime Demo",
        status: "running",
        runtimeMode,
        managedRuntimeProfileId: profileId,
        updatedAt: now,
      },
    });

  await db
    .insert(chats)
    .values({
      id: MANAGED_RUNTIME_DEMO_CHAT_ID,
      sessionId: MANAGED_RUNTIME_DEMO_SESSION_ID,
      title: "Demo chat",
      modelId: "anthropic/claude-haiku-4.5",
    })
    .onConflictDoUpdate({
      target: chats.id,
      set: {
        title: "Demo chat",
        updatedAt: now,
      },
    });
}

export async function prepareManagedRuntimeDemo(
  options: PrepareManagedRuntimeDemoOptions = {},
): Promise<{
  sessionId: string;
  chatId: string;
  sessionUrl: string;
  sandboxState: SandboxState;
}> {
  const runtimeMode = options.runtimeMode ?? "managed_runtime";
  const profileId = options.profileId ?? DEFAULT_MANAGED_RUNTIME_PROFILE_ID;

  await seedDemoRecords({ runtimeMode, profileId });

  const sandbox = await connectSandbox({
    state: {
      type: "vercel",
      sandboxName: getSessionSandboxName(MANAGED_RUNTIME_DEMO_SESSION_ID),
    },
    options: {
      gitUser: {
        name: "Managed Runtime Demo",
        email: "managed-runtime-demo@example.test",
      },
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      vcpus: DEFAULT_SANDBOX_VCPUS,
      ports: DEFAULT_SANDBOX_PORTS,
      baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
      persistent: true,
      resume: true,
      createIfMissing: true,
    },
  });

  const appDir = path.posix.join(sandbox.workingDirectory, "apps/demo");
  await sandbox.mkdir(path.posix.join(appDir, "src"), { recursive: true });
  await Promise.all([
    sandbox.writeFile(
      path.posix.join(appDir, "package.json"),
      `${DEMO_PACKAGE_JSON}\n`,
      "utf-8",
    ),
    sandbox.writeFile(
      path.posix.join(appDir, "index.html"),
      DEMO_INDEX_HTML,
      "utf-8",
    ),
    sandbox.writeFile(
      path.posix.join(appDir, "vite.config.js"),
      DEMO_VITE_CONFIG,
      "utf-8",
    ),
    sandbox.writeFile(
      path.posix.join(appDir, "src/main.jsx"),
      DEMO_MAIN,
      "utf-8",
    ),
    sandbox.writeFile(
      path.posix.join(appDir, "src/styles.css"),
      DEMO_STYLES,
      "utf-8",
    ),
  ]);

  const sandboxState = (sandbox.getState?.() ?? {
    type: "vercel",
    sandboxName: getSessionSandboxName(MANAGED_RUNTIME_DEMO_SESSION_ID),
    expiresAt: Date.now() + DEFAULT_SANDBOX_TIMEOUT_MS,
  }) as SandboxState;
  const [currentSession] = await db
    .select({ lifecycleVersion: sessions.lifecycleVersion })
    .from(sessions)
    .where(eq(sessions.id, MANAGED_RUNTIME_DEMO_SESSION_ID))
    .limit(1);

  await db
    .update(sessions)
    .set({
      sandboxState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(
        currentSession?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(sandboxState),
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, MANAGED_RUNTIME_DEMO_SESSION_ID));

  return {
    sessionId: MANAGED_RUNTIME_DEMO_SESSION_ID,
    chatId: MANAGED_RUNTIME_DEMO_CHAT_ID,
    sessionUrl: `/sessions/${MANAGED_RUNTIME_DEMO_SESSION_ID}/chats/${MANAGED_RUNTIME_DEMO_CHAT_ID}`,
    sandboxState,
  };
}
