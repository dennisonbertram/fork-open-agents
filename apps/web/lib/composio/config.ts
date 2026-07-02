import "server-only";

import { getComposioErrorKind, getComposioUserFacingError } from "./errors";

export type ComposioConfigState =
  | {
      configured: true;
      apiKey: string;
    }
  | {
      configured: false;
      reason: "missing_api_key";
    };

export type ComposioServiceStatus =
  | {
      configured: false;
      available: false;
      reason: "missing_api_key";
      message: string;
    }
  | {
      configured: true;
      available: true;
      reason: "ok";
      message: string;
    }
  | {
      configured: true;
      available: false;
      reason: "invalid_api_key" | "unreachable";
      message: string;
    };

export function getComposioConfig(): ComposioConfigState {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();

  if (!apiKey) {
    return {
      configured: false,
      reason: "missing_api_key",
    };
  }

  return {
    configured: true,
    apiKey,
  };
}

export function getComposioDisabledStatus(): ComposioServiceStatus {
  return {
    configured: false,
    available: false,
    reason: "missing_api_key",
    message: "COMPOSIO_API_KEY is not configured.",
  };
}

export function getComposioConfiguredStatus(): ComposioServiceStatus {
  return {
    configured: true,
    available: true,
    reason: "ok",
    // "Configured" only means COMPOSIO_API_KEY is present in this
    // deployment's env — it is NOT a live health check, so this copy must
    // not read as "verified working" (issue #800). Run a live check
    // (?live=1) to confirm connectivity.
    message:
      "Composio is configured. Run a live check to confirm it's working.",
  };
}

export function getComposioUnavailableStatus(
  error: unknown,
): ComposioServiceStatus {
  const kind = getComposioErrorKind(error);

  return {
    configured: true,
    available: false,
    reason:
      kind === "composio_invalid_api_key" ? "invalid_api_key" : "unreachable",
    message: getComposioUserFacingError(error),
  };
}
