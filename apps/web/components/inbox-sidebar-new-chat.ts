type SandboxFreeChatInput = {
  isNewBranch: false;
  sandboxType: "vercel";
  autoCommitPush: false;
  autoCreatePr: false;
};

/**
 * Returns the minimum CreateSessionInput needed to create a sandbox-free
 * (no-repo, no-VM) chat session. Omits all repo fields so the server creates
 * a plain chat with sandboxState: null.
 */
export function buildSandboxFreeChatInput(): SandboxFreeChatInput {
  return {
    isNewBranch: false,
    sandboxType: "vercel",
    autoCommitPush: false,
    autoCreatePr: false,
  };
}
