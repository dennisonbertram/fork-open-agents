import type { Session } from "@/lib/db/schema";
import type { ReconnectionStatus, SandboxInfo } from "./session-chat-context";

export function shouldAutoStartProvisioningSandbox({
  session,
  sandboxInfo,
  isArchived,
  isCreatingSandbox,
  isRestoringSnapshot,
  reconnectionStatus,
  lifecycleState,
}: {
  session: Pick<
    Session,
    "cloneUrl" | "repoOwner" | "repoName" | "sandboxState"
  >;
  sandboxInfo: SandboxInfo | null;
  isArchived: boolean;
  isCreatingSandbox: boolean;
  isRestoringSnapshot: boolean;
  reconnectionStatus: ReconnectionStatus;
  lifecycleState: Session["lifecycleState"] | null;
}): boolean {
  if (isArchived || isCreatingSandbox || isRestoringSnapshot || sandboxInfo) {
    return false;
  }

  if (reconnectionStatus === "idle" || reconnectionStatus === "checking") {
    return false;
  }

  if (lifecycleState !== "provisioning") {
    return false;
  }

  if (!session.repoOwner || !session.repoName || !session.cloneUrl) {
    return false;
  }

  return session.sandboxState !== null;
}
