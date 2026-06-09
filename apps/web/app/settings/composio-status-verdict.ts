import type { ComposioSettingsResponse } from "@/app/api/settings/composio/route";
import type {
  ReadinessCheck,
  ReadinessStatus,
} from "@/components/ui/readiness-verdict";

type ComposioStatus = ComposioSettingsResponse["status"];

export interface ComposioVerdict {
  status: ReadinessStatus;
  headline: string;
  subtext?: string;
  checks: ReadinessCheck[];
}

const API_KEY = "COMPOSIO_API_KEY";

/**
 * Translate the deploy-time Composio status into a single plain-language verdict
 * for end users. The raw `COMPOSIO_API_KEY` env-var name only ever appears inside
 * the operator-details check, never in the headline/subtext a normal user reads.
 */
export function mapComposioStatusToVerdict(
  status: ComposioStatus | undefined,
): ComposioVerdict {
  if (!status) {
    return {
      status: "error",
      headline: "Checking Composio…",
      checks: [],
    };
  }

  if (status.configured && status.available) {
    return {
      status: "ready",
      headline: "Composio is connected.",
      subtext:
        "Your account credentials stay in Composio — Open Agents only stores which tools you pick.",
      checks: [
        {
          id: "api-key",
          label: "Composio API key",
          status: "ready",
          present: [API_KEY],
        },
      ],
    };
  }

  if (!status.configured) {
    return {
      status: "unavailable",
      headline: "Composio isn't set up on this deployment.",
      subtext: "Ask your workspace administrator to connect Composio.",
      checks: [
        {
          id: "api-key",
          label: "Composio API key",
          status: "missing",
          missing: [API_KEY],
        },
      ],
    };
  }

  // configured but not available
  if (status.reason === "invalid_api_key") {
    return {
      status: "error",
      headline: "Composio can't connect — the API key looks invalid.",
      subtext: "Ask your workspace administrator to check the configured key.",
      checks: [
        {
          id: "api-key",
          label: "Composio API key",
          status: "missing",
          detail: "A key is set, but Composio rejected it.",
          present: [API_KEY],
        },
      ],
    };
  }

  return {
    status: "error",
    headline: "Can't reach Composio right now.",
    subtext: "Try again in a moment, or ask your workspace administrator.",
    checks: [
      {
        id: "api-key",
        label: "Composio API key",
        status: "ready",
        present: [API_KEY],
      },
    ],
  };
}
