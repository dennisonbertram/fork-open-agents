import type { Octokit } from "@octokit/rest";

export type WorkflowItem = {
  id: number;
  name: string;
  path: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  dispatch: WorkflowDispatchConfig | null;
};

export type WorkflowDispatchInputType = "string" | "boolean" | "choice";

export type WorkflowDispatchInput = {
  name: string;
  description?: string;
  required: boolean;
  default?: string;
  type: WorkflowDispatchInputType;
  options: string[];
};

export type WorkflowDispatchConfig = {
  enabled: boolean;
  inputs: WorkflowDispatchInput[];
};

type GitHubWorkflow = {
  id: number;
  name?: string | null;
  path?: string | null;
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
};

function countIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseScalar(line: string): string {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return "";
  }
  return unquote(line.slice(separatorIndex + 1).trim());
}

function workflowDispatchIsInline(contents: string): boolean {
  return contents
    .split("\n")
    .some((line) =>
      /^\s*on:\s*(?:workflow_dispatch|\[.*workflow_dispatch.*\])\s*$/i.test(
        line,
      ),
    );
}

export function parseWorkflowDispatchConfig(
  contents: string,
): WorkflowDispatchConfig | null {
  const lines = contents.split("\n");
  if (workflowDispatchIsInline(contents)) {
    return { enabled: true, inputs: [] };
  }

  const onIndex = lines.findIndex((line) => /^\s*on:\s*$/.test(line));
  if (onIndex === -1) {
    return null;
  }

  const onIndent = countIndent(lines[onIndex] ?? "");
  const dispatchIndex = lines.findIndex((line, index) => {
    if (index <= onIndex) return false;
    const indent = countIndent(line);
    return (
      indent > onIndent &&
      /^\s*workflow_dispatch:\s*$/.test(line) &&
      !line.trimStart().startsWith("#")
    );
  });
  if (dispatchIndex === -1) {
    return null;
  }

  const dispatchIndent = countIndent(lines[dispatchIndex] ?? "");
  const inputsIndex = lines.findIndex((line, index) => {
    if (index <= dispatchIndex) return false;
    const indent = countIndent(line);
    if (indent <= dispatchIndent && line.trim()) return false;
    return indent > dispatchIndent && /^\s*inputs:\s*$/.test(line);
  });
  if (inputsIndex === -1) {
    return { enabled: true, inputs: [] };
  }

  const inputsIndent = countIndent(lines[inputsIndex] ?? "");
  const inputs: WorkflowDispatchInput[] = [];
  let current: WorkflowDispatchInput | null = null;
  let inOptions = false;
  const flush = () => {
    if (current) {
      inputs.push(current);
    }
    current = null;
    inOptions = false;
  };

  for (let index = inputsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = countIndent(line);
    if (indent <= inputsIndent) {
      break;
    }

    const inputMatch = line.match(/^\s{1,}([A-Za-z0-9_-]+):\s*$/);
    if (inputMatch && indent === inputsIndent + 2) {
      flush();
      current = {
        name: inputMatch[1] ?? "",
        required: false,
        type: "string",
        options: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (/^\s*options:\s*$/.test(line)) {
      inOptions = true;
      continue;
    }

    if (inOptions && /^\s*-\s+/.test(line)) {
      current.options.push(unquote(trimmed.replace(/^-\s+/, "")));
      continue;
    }

    inOptions = false;
    if (/^\s*description:/.test(line)) {
      current.description = parseScalar(line);
    } else if (/^\s*required:/.test(line)) {
      current.required = parseScalar(line) === "true";
    } else if (/^\s*default:/.test(line)) {
      current.default = parseScalar(line);
    } else if (/^\s*type:/.test(line)) {
      const type = parseScalar(line);
      current.type = type === "boolean" || type === "choice" ? type : "string";
    }
  }
  flush();

  return { enabled: true, inputs };
}

async function readWorkflowDispatchConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  defaultBranch: string,
): Promise<WorkflowDispatchConfig | null> {
  if (!path) {
    return null;
  }

  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner, repo, path, ref: defaultBranch },
    );
    const data = response.data as {
      type?: string;
      content?: string;
      encoding?: string;
    };
    if (data.type !== "file" || !data.content) {
      return null;
    }

    const contents =
      data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf8")
        : data.content;
    return parseWorkflowDispatchConfig(contents);
  } catch {
    return null;
  }
}

export async function listWorkflows(
  octokit: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string,
): Promise<{ totalCount: number; workflows: WorkflowItem[] }> {
  const response = await octokit.rest.actions.listRepoWorkflows({
    owner,
    repo,
    per_page: 100,
  });
  const data = response.data as {
    total_count?: number;
    workflows?: GitHubWorkflow[];
  };

  const workflows = await Promise.all(
    (data.workflows ?? []).map(async (workflow) => {
      const path = workflow.path ?? "";
      return {
        id: workflow.id,
        name: workflow.name ?? "Workflow",
        path,
        state: workflow.state ?? "unknown",
        createdAt: workflow.created_at ?? "",
        updatedAt: workflow.updated_at ?? "",
        htmlUrl: workflow.html_url ?? "",
        dispatch: await readWorkflowDispatchConfig(
          octokit,
          owner,
          repo,
          path,
          defaultBranch,
        ),
      };
    }),
  );

  return {
    totalCount: data.total_count ?? data.workflows?.length ?? 0,
    workflows,
  };
}
