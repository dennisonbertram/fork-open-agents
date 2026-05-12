import type { HarnessConfig } from "@/lib/harness/config";
import type { TaskClassification } from "./task-classifier";

export type ModePolicyDecision =
  | {
      action: "direct_chat";
      reason: string;
    }
  | {
      action: "start_verified_build";
      reason: string;
    }
  | {
      action: "start_investigation";
      reason: string;
    }
  | {
      action: "reject_direct_mode";
      reason: string;
    };

export function decideVerifiedBuildMode(params: {
  classification: TaskClassification;
  config: HarnessConfig;
  directModeRequested?: boolean;
}): ModePolicyDecision {
  if (params.directModeRequested && !params.config.allowedDirectMode) {
    return {
      action: "reject_direct_mode",
      reason: "direct_mode_disabled",
    };
  }

  if (!params.config.enabled) {
    return {
      action: "direct_chat",
      reason: "harness_disabled",
    };
  }

  if (params.directModeRequested && params.config.allowedDirectMode) {
    return {
      action: "direct_chat",
      reason: "direct_mode_allowed",
    };
  }

  if (params.classification.mode === "verified_build") {
    return {
      action: "start_verified_build",
      reason: params.classification.reasonCode,
    };
  }

  if (params.classification.mode === "investigation") {
    return {
      action: "start_investigation",
      reason: params.classification.reasonCode,
    };
  }

  return {
    action: "direct_chat",
    reason: params.classification.reasonCode,
  };
}
