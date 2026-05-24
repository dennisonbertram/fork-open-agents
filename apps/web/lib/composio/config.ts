import "server-only";

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
      reason: "unreachable";
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
    message: "Composio is configured.",
  };
}

export function getComposioUnavailableStatus(
  error: unknown,
): ComposioServiceStatus {
  const message = error instanceof Error ? error.message : String(error);

  return {
    configured: true,
    available: false,
    reason: "unreachable",
    message: message || "Composio is unreachable.",
  };
}
