/**
 * Pure repo-grouping logic for the inbox sidebar.
 *
 * Repo groups are NOT derived from sessions alone. A repo also stays visible
 * when it has agents or loops attached — otherwise clearing every branch for a
 * repo would make the repo (and its Agents/Loops sub-groups) silently vanish
 * even though that tooling still exists. Session repos and "anchor" repos
 * (those carrying agents/loops) are unioned; anchor-only repos render with an
 * empty session list.
 */

/** Minimal repo identity shared by sessions, agents, and loops. */
export type SidebarRepoRef = {
  repoOwner?: string | null;
  repoName?: string | null;
};

export type RepoGroup<S> = {
  id: string;
  label: string;
  /** Canonical repo for the group (null for the unscoped "Chats" group). */
  repoOwner: string | null;
  repoName: string | null;
  sessions: S[];
};

const UNSCOPED_GROUP_ID = "repo:unscoped";

export function getRepoGroupId(ref: SidebarRepoRef): string {
  const repoName = ref.repoName?.trim();
  const repoOwner = ref.repoOwner?.trim();
  if (!repoName) {
    return UNSCOPED_GROUP_ID;
  }
  return `repo:${repoOwner ?? ""}/${repoName}`.toLowerCase();
}

export function getRepoGroupLabel(ref: SidebarRepoRef): string {
  const repoName = ref.repoName?.trim();
  const repoOwner = ref.repoOwner?.trim();
  if (!repoName) {
    return "Chats";
  }
  return repoOwner ? `${repoOwner}/${repoName}` : repoName;
}

export function getRepoGroupContentId(groupId: string): string {
  return `repo-group-panel-${groupId.replace(/[^a-z0-9-]+/gi, "-")}`;
}

/**
 * Group sessions by repo, then append any anchor repos (with agents/loops) that
 * don't already have a session group — so a repo with tooling but no active
 * branches still shows up. The unscoped "Chats" group is pinned first;
 * anchor-only repos are appended alphabetically after the session groups.
 */
export function buildRepoGroups<S extends SidebarRepoRef>(
  sessions: S[],
  anchorRepos: SidebarRepoRef[] = [],
): RepoGroup<S>[] {
  const groups = new Map<string, RepoGroup<S>>();

  for (const session of sessions) {
    const id = getRepoGroupId(session);
    const existing = groups.get(id);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    const repoName = session.repoName?.trim() ?? null;
    groups.set(id, {
      id,
      label: getRepoGroupLabel(session),
      repoOwner: repoName ? (session.repoOwner?.trim() ?? null) : null,
      repoName,
      sessions: [session],
    });
  }

  const result = Array.from(groups.values());
  const unscopedIndex = result.findIndex((g) => g.id === UNSCOPED_GROUP_ID);
  if (unscopedIndex > 0) {
    const [unscoped] = result.splice(unscopedIndex, 1);
    result.unshift(unscoped);
  }

  const anchorOnly: RepoGroup<S>[] = [];
  const seenAnchor = new Set<string>();
  for (const ref of anchorRepos) {
    const repoName = ref.repoName?.trim();
    if (!repoName) {
      continue;
    }
    const id = getRepoGroupId(ref);
    if (groups.has(id) || seenAnchor.has(id)) {
      continue;
    }
    seenAnchor.add(id);
    anchorOnly.push({
      id,
      label: getRepoGroupLabel(ref),
      repoOwner: ref.repoOwner?.trim() ?? null,
      repoName,
      sessions: [],
    });
  }
  anchorOnly.sort((a, b) => a.label.localeCompare(b.label));

  return [...result, ...anchorOnly];
}
