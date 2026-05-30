const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

interface SmokeCheck {
  readonly path: string;
  readonly label: string;
  readonly validate: (result: SmokeResponse) => void;
}

interface SmokeResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

class SmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeError";
  }
}

function getDeploymentUrl(): URL {
  const rawUrl = process.env.DEPLOYMENT_URL?.trim();
  if (!rawUrl) {
    throw new SmokeError("DEPLOYMENT_URL is required.");
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new SmokeError("DEPLOYMENT_URL must be an http(s) URL.");
    }
    return url;
  } catch (error) {
    if (error instanceof SmokeError) {
      throw error;
    }
    throw new SmokeError("DEPLOYMENT_URL is not a valid URL.");
  }
}

function createHeaders(): Headers {
  const headers = new Headers({
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    "User-Agent": "open-agents-preview-smoke/1.0",
  });

  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypassSecret) {
    headers.set("x-vercel-protection-bypass", bypassSecret);
    headers.set("x-vercel-set-bypass-cookie", "true");
  }

  return headers;
}

function createUrl(baseUrl: URL, path: string): string {
  return new URL(path, baseUrl).toString();
}

function looksLikeVercelProtectionPage(response: SmokeResponse): boolean {
  if (!response.contentType.includes("text/html")) {
    return false;
  }

  const body = response.body.toLowerCase();
  return (
    body.includes("deployment protection") ||
    body.includes("vercel authentication") ||
    body.includes("x-vercel-protection-bypass")
  );
}

function assertOkResponse(response: SmokeResponse): void {
  if (looksLikeVercelProtectionPage(response)) {
    throw new SmokeError(
      `${response.url} returned a Vercel deployment protection page. Configure VERCEL_AUTOMATION_BYPASS_SECRET for protected previews.`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new SmokeError(
      `${response.url} returned unexpected status ${response.status}.`,
    );
  }
}

function parseJson(response: SmokeResponse): unknown {
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new SmokeError(`${response.url} did not return valid JSON.`);
  }
}

function assertRecord(value: unknown, url: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SmokeError(`${url} returned an unexpected JSON shape.`);
  }
  return value as Record<string, unknown>;
}

async function fetchWithTimeout(
  url: string,
  headers: Headers,
): Promise<SmokeResponse> {
  let currentUrl = url;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    for (
      let redirectCount = 0;
      redirectCount <= MAX_REDIRECTS;
      redirectCount++
    ) {
      const response = await fetch(currentUrl, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status < 300 || response.status >= 400) {
        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();

        return {
          url: currentUrl,
          status: response.status,
          contentType,
          body,
        };
      }

      const nextLocation = response.headers.get("location");
      if (!nextLocation) {
        throw new SmokeError(
          `${currentUrl} returned redirect status ${response.status} without a Location header.`,
        );
      }

      const nextUrl = new URL(nextLocation, currentUrl);
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        throw new SmokeError(
          `${currentUrl} redirected to a different origin (${nextUrl.origin}); refusing to forward preview smoke headers.`,
        );
      }

      currentUrl = nextUrl.toString();
    }

    throw new SmokeError(
      `${url} exceeded ${MAX_REDIRECTS} same-origin redirects.`,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SmokeError(
        `${currentUrl} timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
      );
    }
    if (error instanceof SmokeError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SmokeError(`${currentUrl} failed to load: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

const checks: SmokeCheck[] = [
  {
    path: "/",
    label: "home page",
    validate(response) {
      assertOkResponse(response);
      if (!response.contentType.includes("text/html")) {
        throw new SmokeError(
          `${response.url} returned ${response.contentType || "no content type"} instead of HTML.`,
        );
      }
    },
  },
  {
    path: "/api/auth/info",
    label: "auth info API",
    validate(response) {
      assertOkResponse(response);
      assertRecord(parseJson(response), response.url);
    },
  },
  {
    path: "/api/models",
    label: "models API",
    validate(response) {
      assertOkResponse(response);
      const data = assertRecord(parseJson(response), response.url);
      if (!Array.isArray(data.models) || data.models.length === 0) {
        throw new SmokeError(
          `${response.url} did not return any available models.`,
        );
      }
    },
  },
];

async function runPreviewSmoke(): Promise<void> {
  const deploymentUrl = getDeploymentUrl();
  const headers = createHeaders();
  const summaries: string[] = [];

  for (const check of checks) {
    const url = createUrl(deploymentUrl, check.path);
    const response = await fetchWithTimeout(url, headers);
    check.validate(response);
    summaries.push(`${check.label}: ${response.status}`);
  }

  console.log(
    `Preview smoke passed for ${deploymentUrl.origin}: ${summaries.join(", ")}`,
  );
}

runPreviewSmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Preview smoke failed: ${message}`);
  process.exit(1);
});
