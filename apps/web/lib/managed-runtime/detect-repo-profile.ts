/**
 * detectRepoProfile — pure auto-detect helper.
 *
 * Maps repository file markers to a managed-runtime profile id.
 * Returns null when no marker matches (caller should fall back to the default
 * profile).
 *
 * Precedence (highest to lowest):
 *   1. python-uv  — pyproject.toml | requirements.txt | any *.py file
 *   2. go-toolchain — go.mod
 *   3. rust-cargo — Cargo.toml
 *   4. docker-in-sandbox — Dockerfile | docker-compose.yml | compose.yml
 *   5. null (fall back to caller default)
 *
 * Rationale: Python, Go and Rust are "application language" signals that are
 * stronger indicators of the primary dev loop than a Dockerfile (which might
 * just be a deployment artefact). Docker wins over no-match because it implies
 * the repo's dev loop is container-based.
 */

type FileEntry = { path: string } | string;

function toPath(entry: FileEntry): string {
  return typeof entry === "string" ? entry : entry.path;
}

/**
 * Detect the most appropriate managed-runtime profile for a repository by
 * examining its file listing.
 *
 * @param files - Array of file path strings or objects with a `path` property.
 * @returns A managed-runtime profile id, or null if no marker was found.
 */
export function detectRepoProfile(
  files: { path: string }[] | string[],
): string | null {
  const paths = (files as FileEntry[]).map(toPath);

  // 1. Python — pyproject.toml or requirements.txt take precedence over bare *.py
  const hasPyprojectToml = paths.some(
    (p) => p === "pyproject.toml" || p.endsWith("/pyproject.toml"),
  );
  const hasRequirementsTxt = paths.some(
    (p) => p === "requirements.txt" || p.endsWith("/requirements.txt"),
  );
  const hasPyFile = paths.some((p) => p.endsWith(".py"));

  if (hasPyprojectToml || hasRequirementsTxt || hasPyFile) {
    return "python-uv";
  }

  // 2. Go
  const hasGoMod = paths.some((p) => p === "go.mod" || p.endsWith("/go.mod"));
  if (hasGoMod) {
    return "go-toolchain";
  }

  // 3. Rust
  const hasCargoToml = paths.some(
    (p) => p === "Cargo.toml" || p.endsWith("/Cargo.toml"),
  );
  if (hasCargoToml) {
    return "rust-cargo";
  }

  // 4. Docker
  const hasDockerfile = paths.some(
    (p) => p === "Dockerfile" || p.endsWith("/Dockerfile"),
  );
  const hasDockerCompose = paths.some(
    (p) =>
      p === "docker-compose.yml" ||
      p.endsWith("/docker-compose.yml") ||
      p === "docker-compose.yaml" ||
      p.endsWith("/docker-compose.yaml") ||
      p === "compose.yml" ||
      p.endsWith("/compose.yml") ||
      p === "compose.yaml" ||
      p.endsWith("/compose.yaml"),
  );
  if (hasDockerfile || hasDockerCompose) {
    return "docker-in-sandbox";
  }

  return null;
}
