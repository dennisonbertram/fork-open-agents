export async function createOpenAgentsSandboxBridge({ credentialRef }) {
  if (!/^credential-ref:[A-Za-z0-9._:-]+$/.test(credentialRef ?? "")) {
    throw new Error("Open Agents bridge requires credential-ref:*");
  }

  return {
    async connect({ run_id, request = {}, signal } = {}) {
      if (!request.sandbox_state) {
        throw new Error("Open Agents bridge requires request.sandbox_state");
      }

      const { connectSandbox } = await import("@open-agents/sandbox");
      const sandbox = await connectSandbox(request.sandbox_state);
      signal?.addEventListener(
        "abort",
        () => {
          void sandbox.stop().catch(() => undefined);
        },
        { once: true },
      );

      return {
        sandbox_ref: `open-agents:${request.session_id ?? run_id}`,
        sandbox: {
          workingDirectory: sandbox.workingDirectory,
          exec: (command, cwd, timeoutMs, options) =>
            sandbox.exec(command, cwd, timeoutMs, options),
          ...(sandbox.execDetached
            ? {
                execDetached: (command, cwd) =>
                  sandbox.execDetached(command, cwd),
              }
            : {}),
          ...(sandbox.domain ? { domain: (port) => sandbox.domain(port) } : {}),
          ...(sandbox.getState ? { getState: () => sandbox.getState() } : {}),
          stop: () => sandbox.stop(),
        },
      };
    },
  };
}

export default createOpenAgentsSandboxBridge;
