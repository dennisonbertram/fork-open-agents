type CreateRunResponse = {
  agentRun?: {
    id: string;
    status: string;
    workflowRunId: string | null;
    links: { status: string; proof: string };
  };
  error?: string;
};

function readAgentApiSmokeArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function requestAgentApiSmokeJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body;
}

async function runAgentApiSmoke() {
  const baseUrl = (
    readAgentApiSmokeArg("--base-url") ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const apiKeyEnv =
    readAgentApiSmokeArg("--api-key-env") ?? "OPEN_AGENTS_API_KEY";
  const repo = readAgentApiSmokeArg("--repo");
  const runtimeMode =
    readAgentApiSmokeArg("--runtime-mode") ?? "managed_runtime";
  const expectTerminal =
    readAgentApiSmokeArg("--expect-terminal") ?? "completed";
  const apiKey = process.env[apiKeyEnv];

  if (!apiKey) {
    throw new Error(`Missing API key env var ${apiKeyEnv}`);
  }

  const repository = repo
    ? {
        owner: repo.split("/")[0],
        name: repo.split("/")[1],
        newBranch: true,
      }
    : undefined;
  const idempotencyKey = `smoke-${Date.now()}`;
  const createBody = {
    prompt: "Inspect the repository and respond with a concise status summary.",
    title: "Agent API smoke",
    repository,
    runtimeMode,
    metadata: { client: "agent-api-smoke" },
  };

  const first = await requestAgentApiSmokeJson<CreateRunResponse>(
    `${baseUrl}/api/v1/agent-runs`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(createBody),
    },
  );
  const replay = await requestAgentApiSmokeJson<CreateRunResponse>(
    `${baseUrl}/api/v1/agent-runs`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(createBody),
    },
  );

  if (!first.agentRun || replay.agentRun?.id !== first.agentRun.id) {
    throw new Error("Idempotency replay did not return the same API run");
  }

  let current = first.agentRun;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const next = await requestAgentApiSmokeJson<CreateRunResponse>(
      `${baseUrl}${current.links.status}`,
      { headers: { authorization: `Bearer ${apiKey}` } },
    );
    if (!next.agentRun) {
      throw new Error("Status response did not include agentRun");
    }
    current = next.agentRun;
    if (["completed", "failed", "cancelled"].includes(current.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(
    JSON.stringify(
      {
        runId: current.id,
        status: current.status,
        workflowRunId: current.workflowRunId,
      },
      null,
      2,
    ),
  );

  if (current.status !== expectTerminal) {
    process.exitCode = 1;
  }
}

runAgentApiSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
