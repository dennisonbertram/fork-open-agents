import type { Octokit } from "@octokit/rest";

export type ProxiedJobLogs = {
  text: string;
  bytes: number;
  originalBytes: number;
  truncated: boolean;
  maxBytes: number;
};

export const MAX_PROXIED_JOB_LOG_BYTES = 512 * 1024;

function getResponseDataText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data);
  }
  return "";
}

function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) {
    return text;
  }

  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    bytes += characterBytes;
    result += character;
  }

  return result;
}

export async function proxyJobLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  jobId: number,
): Promise<ProxiedJobLogs> {
  const response = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
    owner,
    repo,
    job_id: jobId,
  });
  const text = getResponseDataText(response.data);
  const originalBytes = new TextEncoder().encode(text).byteLength;
  const truncatedText = truncateToUtf8Bytes(text, MAX_PROXIED_JOB_LOG_BYTES);

  return {
    text: truncatedText,
    bytes: new TextEncoder().encode(truncatedText).byteLength,
    originalBytes,
    truncated: originalBytes > MAX_PROXIED_JOB_LOG_BYTES,
    maxBytes: MAX_PROXIED_JOB_LOG_BYTES,
  };
}
