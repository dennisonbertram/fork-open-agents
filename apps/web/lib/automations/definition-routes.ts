export function canonicalNewAutomationUrl(repository?: {
  owner: string;
  name: string;
}): string {
  if (!repository) return "/automations/new";
  const params = new URLSearchParams({
    repoOwner: repository.owner,
    repoName: repository.name,
  });
  return `/automations/new?${params.toString()}`;
}

export function canonicalBackgroundAutomationDetailUrl(
  agentId: string,
): string {
  return `/automations/background-agent/${encodeURIComponent(agentId)}`;
}

export function canonicalBackgroundAutomationEditUrl(agentId: string): string {
  return `${canonicalBackgroundAutomationDetailUrl(agentId)}/edit`;
}

export function canonicalNewLoopAutomationUrl(repository?: {
  owner: string;
  name: string;
}): string {
  if (!repository) return "/automations/agent-loop/new";
  const params = new URLSearchParams({
    repoOwner: repository.owner,
    repoName: repository.name,
  });
  return `/automations/agent-loop/new?${params.toString()}`;
}

export function canonicalLoopAutomationDetailUrl(loopId: string): string {
  return `/automations/agent-loop/${encodeURIComponent(loopId)}`;
}

export function canonicalLoopAutomationEditUrl(loopId: string): string {
  return `${canonicalLoopAutomationDetailUrl(loopId)}/edit`;
}
