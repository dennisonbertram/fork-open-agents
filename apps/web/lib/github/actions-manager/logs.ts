import type { Octokit } from "@octokit/rest";

export type ProxiedJobLogs = {
  text: string;
  bytes: number;
};

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

  return {
    text,
    bytes: new TextEncoder().encode(text).byteLength,
  };
}
