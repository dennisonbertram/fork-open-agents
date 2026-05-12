import type { Sandbox } from "@open-agents/sandbox";

type CredentialRef = `credential-ref:${string}`;

export type OpenAgentsSandboxBridgeInput = {
  credentialRef: string;
  connectSandbox: (state: unknown) => Promise<Sandbox>;
  revokeSetupToken?: () => Promise<void>;
};

export type OpenAgentsSandboxBridgeConnectInput = {
  run_id: string;
  request?: {
    sandbox_state?: unknown;
    session_id?: string;
  };
  plan?: unknown;
  signal?: AbortSignal;
};

function isCredentialRef(value: string): value is CredentialRef {
  return /^credential-ref:[A-Za-z0-9._:-]+$/.test(value);
}

function narrowSandbox(sandbox: Sandbox) {
  return {
    workingDirectory: sandbox.workingDirectory,
    exec: (
      command: string,
      cwd: string,
      timeoutMs: number,
      options?: { signal?: AbortSignal },
    ) => sandbox.exec(command, cwd, timeoutMs, options),
    ...(sandbox.execDetached
      ? {
          execDetached: (command: string, cwd: string) =>
            sandbox.execDetached?.(command, cwd),
        }
      : {}),
    ...(sandbox.domain
      ? { domain: (port: number) => sandbox.domain?.(port) }
      : {}),
    ...(sandbox.getState ? { getState: () => sandbox.getState?.() } : {}),
    stop: () => sandbox.stop(),
  };
}

export async function createOpenAgentsSandboxBridge(
  input: OpenAgentsSandboxBridgeInput,
) {
  if (!isCredentialRef(input.credentialRef)) {
    throw new Error("Open Agents sandbox bridge requires credential-ref:*");
  }

  return {
    async connect(connectInput: OpenAgentsSandboxBridgeConnectInput) {
      const sandboxState = connectInput.request?.sandbox_state;
      if (!sandboxState) {
        throw new Error("Open Agents sandbox bridge requires sandbox_state");
      }

      const sandbox = await input.connectSandbox(sandboxState);
      const abortListener = () => {
        void sandbox.stop().catch(() => undefined);
      };
      connectInput.signal?.addEventListener("abort", abortListener, {
        once: true,
      });

      try {
        return {
          sandbox_ref: `open-agents:${
            connectInput.request?.session_id ?? connectInput.run_id
          }`,
          sandbox: narrowSandbox(sandbox),
        };
      } finally {
        await input.revokeSetupToken?.();
      }
    },
  };
}
