type ProofResponse = {
  proof?: {
    runId: string;
    status: "passed" | "failed" | "blocked";
    checks: Array<{
      id: string;
      status: string;
      summary: string;
      required: boolean;
    }>;
  };
  error?: string;
};

function readAgentApiProofArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function runAgentApiProofCheck() {
  const baseUrl = readAgentApiProofArg("--base-url") ?? "http://localhost:3000";
  const apiKeyEnv =
    readAgentApiProofArg("--api-key-env") ?? "OPEN_AGENTS_API_KEY";
  const runId = readAgentApiProofArg("--run-id");
  const expectedProof = readAgentApiProofArg("--expect-proof") ?? "passed";
  const apiKey = process.env[apiKeyEnv];

  if (!runId || !apiKey) {
    throw new Error("--run-id and a populated API key env var are required");
  }

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/v1/agent-runs/${encodeURIComponent(runId)}/proof`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );
  const body = (await response.json()) as ProofResponse;
  if (!response.ok || !body.proof) {
    throw new Error(body.error ?? `Proof request failed: ${response.status}`);
  }

  console.log(
    JSON.stringify(
      {
        runId: body.proof.runId,
        status: body.proof.status,
        failedRequiredChecks: body.proof.checks
          .filter((check) => check.required && check.status !== "passed")
          .map((check) => ({
            id: check.id,
            status: check.status,
            summary: check.summary,
          })),
      },
      null,
      2,
    ),
  );

  if (body.proof.status !== expectedProof) {
    process.exitCode = 1;
  }
}

runAgentApiProofCheck().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
