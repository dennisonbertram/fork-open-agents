/**
 * Meaningful eval for POC 5b (multi-repo sessions).
 *
 * Proves a real coordinated cross-repo change with per-repo isolation:
 *  1. Build TWO local git repos: "api" (exposes getUserV1) and "consumer"
 *     (calls getUserV1).
 *  2. As ONE logical task, rename the API signature getUserV1 -> fetchUser in
 *     "api" AND update the call site in "consumer".
 *  3. Assert each repo gets its own feature branch + its own commit containing
 *     only its files (no cross-contamination); path routing maps each edited
 *     file to its repo; an edit outside all repos is rejected; the linked-PR
 *     plan cross-references both PRs.
 *  4. Prove coherence: a cross-checkout build script that imports across both
 *     checkouts FAILS on the original (only-api or only-consumer) state and
 *     PASSES once both are changed.
 *  5. Prove branch isolation: committing in api leaves consumer's index/branch
 *     untouched and vice versa.
 *
 * All evidence is written to ../evidence/.
 */
import { spawnSync } from "node:child_process";
import { promises as fs, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MultiRepoCoordinator, repoKey } from "../src/coordinator";
import { git, gitOrThrow } from "../src/git";
import type { SessionRepo } from "../src/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.join(here, "..", "evidence");

const results: { name: string; pass: boolean; detail: string }[] = [];
function assert(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function writeEvidence(name: string, content: string) {
  await fs.writeFile(path.join(EVIDENCE, name), content, "utf-8");
}

// Create a bare-ish source git repo with initial content and a committed main.
function initSourceRepo(dir: string, files: Record<string, string>) {
  gitOrThrow(["init", "-q", "-b", "main", dir], path.dirname(dir));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  gitOrThrow(["add", "-A"], dir);
  gitOrThrow(["commit", "-q", "-m", "initial"], dir);
}

async function main() {
  await fs.rm(EVIDENCE, { recursive: true, force: true });
  await fs.mkdir(EVIDENCE, { recursive: true });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "poc5b-"));
  const sources = path.join(root, "sources");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(sources, { recursive: true });

  // ---- 1. Build two source repos ----
  const apiSrc = path.join(sources, "api");
  const consumerSrc = path.join(sources, "consumer");

  initSourceRepo(apiSrc, {
    "src/users.js":
      [
        "// api repo: exposes the user lookup function.",
        "function getUserV1(id) {",
        '  return { id, name: "user-" + id };',
        "}",
        "module.exports = { getUserV1 };",
        "",
      ].join("\n"),
  });

  initSourceRepo(consumerSrc, {
    "src/app.js":
      [
        "// consumer repo: calls the api function by name.",
        'const api = require("../../api/src/users.js");',
        "function describe(id) {",
        "  const u = api.getUserV1(id);",
        '  return "describe:" + u.name;',
        "}",
        "module.exports = { describe };",
        "",
      ].join("\n"),
  });

  // ---- Coordinated cross-checkout coherence script ----
  // This is the "build/check that fails if only one repo changed". It imports
  // BOTH checkouts and asserts the consumer references the NEW api name.
  const checkScriptPath = path.join(root, "cross-check.js");
  await fs.writeFile(
    checkScriptPath,
    [
      "// Coherence check across the two checkouts.",
      "const fs = require('fs');",
      "const path = require('path');",
      "const ws = process.argv[2];",
      "const apiFile = path.join(ws, 'api', 'src', 'users.js');",
      "const consFile = path.join(ws, 'consumer', 'src', 'app.js');",
      "const apiSrc = fs.readFileSync(apiFile, 'utf-8');",
      "const consSrc = fs.readFileSync(consFile, 'utf-8');",
      "// The new name must be exported by api AND called by consumer.",
      "const apiExportsNew = /function fetchUser\\(/.test(apiSrc) && /fetchUser/.test(apiSrc);",
      "const consumerCallsNew = /api\\.fetchUser\\(/.test(consSrc);",
      "const consumerStillCallsOld = /getUserV1/.test(consSrc);",
      "const apiStillHasOld = /getUserV1/.test(apiSrc);",
      "if (!apiExportsNew) { console.error('api does not export fetchUser'); process.exit(1); }",
      "if (!consumerCallsNew) { console.error('consumer does not call api.fetchUser'); process.exit(1); }",
      "if (consumerStillCallsOld || apiStillHasOld) { console.error('stale getUserV1 reference remains'); process.exit(1); }",
      "console.log('coherent: api.fetchUser exported and consumer calls it');",
      "process.exit(0);",
      "",
    ].join("\n"),
    "utf-8",
  );

  // ---- 2. Set up the multi-repo session ----
  const repos: SessionRepo[] = [
    {
      sessionId: "sess_poc5b",
      repoOwner: "acme",
      repoName: "api",
      branch: "feat/rename-get-user",
      cloneUrl: apiSrc,
      localPath: path.join(workspace, "api"),
      role: "primary",
      orderIndex: 0,
    },
    {
      sessionId: "sess_poc5b",
      repoOwner: "acme",
      repoName: "consumer",
      branch: "feat/adopt-fetch-user",
      cloneUrl: consumerSrc,
      localPath: path.join(workspace, "consumer"),
      role: "secondary",
      orderIndex: 1,
    },
  ];
  const apiRepo = repos[0];
  const consumerRepo = repos[1];

  const coord = new MultiRepoCoordinator({
    sessionId: "sess_poc5b",
    workspaceRoot: workspace,
    repos,
  });
  await coord.cloneAll();

  assert(
    "both repos cloned into distinct workspace paths",
    coord.getState(apiRepo).cloned &&
      coord.getState(consumerRepo).cloned &&
      apiRepo.localPath !== consumerRepo.localPath,
    `${apiRepo.localPath} | ${consumerRepo.localPath}`,
  );

  assert(
    "each repo on its own feature branch after clone",
    coord.getState(apiRepo).currentBranch === apiRepo.branch &&
      coord.getState(consumerRepo).currentBranch === consumerRepo.branch,
    `${coord.getState(apiRepo).currentBranch} / ${coord.getState(consumerRepo).currentBranch}`,
  );

  // ---- 3. Coherence BEFORE the change should FAIL ----
  const before = spawnSync("node", [checkScriptPath, workspace], {
    encoding: "utf-8",
  });
  assert(
    "cross-checkout coherence check FAILS before the coordinated change",
    before.status !== 0,
    `exit=${before.status} ${(before.stderr || "").trim()}`,
  );
  await writeEvidence(
    "coherence-before.txt",
    `exit=${before.status}\nstdout=${before.stdout}\nstderr=${before.stderr}\n`,
  );

  // ---- 4. Path routing checks ----
  const apiFileAbs = path.join(apiRepo.localPath, "src", "users.js");
  const consFileAbs = path.join(consumerRepo.localPath, "src", "app.js");

  const apiRes = coord.router.resolve(apiFileAbs);
  const consRes = coord.router.resolve(consFileAbs);
  assert(
    "path router maps api file -> api repo",
    apiRes !== null && repoKey(apiRes.repo) === "acme/api",
    apiRes ? `${repoKey(apiRes.repo)}:${apiRes.relativePath}` : "null",
  );
  assert(
    "path router maps consumer file -> consumer repo",
    consRes !== null && repoKey(consRes.repo) === "acme/consumer",
    consRes ? `${repoKey(consRes.repo)}:${consRes.relativePath}` : "null",
  );

  // Path outside all repos must be rejected.
  const outsideAbs = path.join(root, "outside", "secret.txt");
  const rejected = await coord.writeFile(outsideAbs, "nope");
  assert(
    "edit to a path outside all repos is REJECTED",
    rejected.success === false,
    rejected.success ? "unexpected success" : rejected.error,
  );
  const outsideRouter = coord.router.resolve(outsideAbs);
  assert(
    "router returns null for path outside all repos",
    outsideRouter === null,
    String(outsideRouter),
  );

  // ---- 5. Apply the coordinated change via path-routed writes ----
  const apiNew = [
    "// api repo: exposes the user lookup function.",
    "function fetchUser(id) {",
    '  return { id, name: "user-" + id };',
    "}",
    "module.exports = { fetchUser };",
    "",
  ].join("\n");
  const wApi = await coord.writeFile(apiFileAbs, apiNew);
  assert(
    "api edit routed and recorded against api repo only",
    wApi.success && wApi.repo === "acme/api",
    wApi.success ? wApi.relativePath : wApi.error,
  );

  const consNew = [
    "// consumer repo: calls the api function by name.",
    'const api = require("../../api/src/users.js");',
    "function describe(id) {",
    "  const u = api.fetchUser(id);",
    '  return "describe:" + u.name;',
    "}",
    "module.exports = { describe };",
    "",
  ].join("\n");
  const wCons = await coord.writeFile(consFileAbs, consNew);
  assert(
    "consumer edit routed and recorded against consumer repo only",
    wCons.success && wCons.repo === "acme/consumer",
    wCons.success ? wCons.relativePath : wCons.error,
  );

  // Dirty-file sets must be disjoint and contain only own files.
  const apiDirty = [...coord.getState(apiRepo).dirtyFiles];
  const consDirty = [...coord.getState(consumerRepo).dirtyFiles];
  assert(
    "dirty file sets are repo-scoped and disjoint",
    apiDirty.length === 1 &&
      apiDirty[0] === "src/users.js" &&
      consDirty.length === 1 &&
      consDirty[0] === "src/app.js",
    `api=[${apiDirty}] consumer=[${consDirty}]`,
  );

  // ---- 6. Commit each repo's slice in isolation ----
  const apiCommit = coord.commitRepo(
    apiRepo,
    "api: rename getUserV1 -> fetchUser",
  );
  const consCommit = coord.commitRepo(
    consumerRepo,
    "consumer: adopt api.fetchUser",
  );

  assert(
    "api commit contains ONLY api files (no consumer contamination)",
    apiCommit.files.length === 1 &&
      apiCommit.files[0] === "src/users.js" &&
      !apiCommit.files.some((f) => f.includes("app.js")),
    `files=[${apiCommit.files}] sha=${apiCommit.commitSha.slice(0, 8)}`,
  );
  assert(
    "consumer commit contains ONLY consumer files (no api contamination)",
    consCommit.files.length === 1 &&
      consCommit.files[0] === "src/app.js" &&
      !consCommit.files.some((f) => f.includes("users.js")),
    `files=[${consCommit.files}] sha=${consCommit.commitSha.slice(0, 8)}`,
  );

  // ---- 7. Branch isolation: each repo's HEAD differs; status clean; logs separate ----
  const apiLog = coord.log(apiRepo);
  const consLog = coord.log(consumerRepo);
  assert(
    "per-repo commit shas differ (independent histories)",
    apiCommit.commitSha !== consCommit.commitSha,
    `${apiCommit.commitSha.slice(0, 8)} != ${consCommit.commitSha.slice(0, 8)}`,
  );
  assert(
    "api log does NOT mention consumer commit and vice versa",
    !apiLog.includes("adopt api.fetchUser") &&
      !consLog.includes("rename getUserV1"),
    "logs are independent",
  );
  assert(
    "both repos have clean working trees after their own commit",
    coord.status(apiRepo) === "" && coord.status(consumerRepo) === "",
    "no stray changes",
  );

  // Prove committing in one repo did not stage anything in the other:
  // make a fresh edit in api, commit it, and confirm consumer is untouched.
  const consStatusBefore = coord.status(consumerRepo);
  const consHeadBefore = gitOrThrow(
    ["rev-parse", "HEAD"],
    consumerRepo.localPath,
  );
  await coord.writeFile(
    path.join(apiRepo.localPath, "src", "extra.js"),
    "module.exports = {};\n",
  );
  coord.commitRepo(apiRepo, "api: add extra");
  const consHeadAfter = gitOrThrow(["rev-parse", "HEAD"], consumerRepo.localPath);
  assert(
    "second commit in api leaves consumer HEAD + index untouched",
    consHeadBefore === consHeadAfter &&
      coord.status(consumerRepo) === consStatusBefore,
    `consumer HEAD stable: ${consHeadAfter.slice(0, 8)}`,
  );

  // ---- 8. Coherence AFTER the change should PASS ----
  const after = spawnSync("node", [checkScriptPath, workspace], {
    encoding: "utf-8",
  });
  assert(
    "cross-checkout coherence check PASSES after both repos changed",
    after.status === 0,
    `exit=${after.status} ${(after.stdout || "").trim()}`,
  );
  await writeEvidence(
    "coherence-after.txt",
    `exit=${after.status}\nstdout=${after.stdout}\nstderr=${after.stderr}\n`,
  );

  // Negative coherence proof: revert ONLY consumer to old call, re-check fails.
  const consReverted = consNew.replace("api.fetchUser(id)", "api.getUserV1(id)");
  await fs.writeFile(consFileAbs, consReverted, "utf-8");
  const partial = spawnSync("node", [checkScriptPath, workspace], {
    encoding: "utf-8",
  });
  assert(
    "coherence check FAILS again if only one repo is changed (partial state)",
    partial.status !== 0,
    `exit=${partial.status} ${(partial.stderr || "").trim()}`,
  );
  // restore for plan/diff dumps
  await fs.writeFile(consFileAbs, consNew, "utf-8");

  // ---- 9. Linked-PR plan ----
  const changeSetId = "cs_poc5b_rename_user";
  const plan = coord.buildLinkedPrPlan({
    changeSetId,
    titleFor: (r) =>
      r.role === "primary"
        ? "Rename getUserV1 to fetchUser"
        : "Adopt api.fetchUser",
  });

  const apiPr = plan.prs.find((p) => p.repoName === "api");
  const consPr = plan.prs.find((p) => p.repoName === "consumer");
  assert(
    "linked-PR plan has one PR per repo with correct head/base",
    plan.prs.length === 2 &&
      apiPr?.head === "feat/rename-get-user" &&
      consPr?.head === "feat/adopt-fetch-user" &&
      apiPr?.base === "main" &&
      consPr?.base === "main",
    `api ${apiPr?.head}->${apiPr?.base}, consumer ${consPr?.head}->${consPr?.base}`,
  );

  const apiXref = plan.crossReferences["acme/api"];
  const consXref = plan.crossReferences["acme/consumer"];
  assert(
    "PR cross-references point at the OTHER repo + share changeSetId",
    apiXref.includes("acme/consumer") &&
      apiXref.includes(changeSetId) &&
      consXref.includes("acme/api") &&
      consXref.includes(changeSetId),
    "cross-reference present in both bodies",
  );

  // ---- 10. Dump per-repo evidence ----
  await writeEvidence(
    "api-commit.txt",
    [
      `branch: ${apiRepo.branch}`,
      `commit: ${apiCommit.commitSha}`,
      `files: ${apiCommit.files.join(", ")}`,
      "",
      "git log --oneline:",
      coord.log(apiRepo),
      "",
      "git status --porcelain (clean expected):",
      coord.status(apiRepo) || "<clean>",
    ].join("\n"),
  );
  await writeEvidence(
    "consumer-commit.txt",
    [
      `branch: ${consumerRepo.branch}`,
      `commit: ${consCommit.commitSha}`,
      `files: ${consCommit.files.join(", ")}`,
      "",
      "git log --oneline:",
      coord.log(consumerRepo),
      "",
      "git status --porcelain (clean expected):",
      coord.status(consumerRepo) || "<clean>",
    ].join("\n"),
  );
  await writeEvidence("api.diff", coord.diffAgainstBase(apiRepo));
  await writeEvidence("consumer.diff", coord.diffAgainstBase(consumerRepo));

  const planEvidence = {
    sessionId: plan.sessionId,
    changeSetId: plan.changeSetId,
    prs: plan.prs,
    crossReferences: plan.crossReferences,
  };
  await writeEvidence(
    "linked-pr-plan.json",
    JSON.stringify(planEvidence, null, 2),
  );

  // Markdown rendering of the linked PRs as the GitHub App would post them.
  const renderedPrs = plan.prs
    .map((pr) => {
      const xref = plan.crossReferences[`${pr.repoOwner}/${pr.repoName}`];
      return [
        `## PR: ${pr.repoOwner}/${pr.repoName} (${pr.role})`,
        `head: \`${pr.head}\`  base: \`${pr.base}\`  commit: \`${(pr.commitSha ?? "").slice(0, 8)}\``,
        "",
        `### ${pr.title}`,
        "",
        xref,
        "",
      ].join("\n");
    })
    .join("\n---\n\n");
  await writeEvidence("linked-pr-bodies.md", renderedPrs);

  // ---- Summary ----
  const passCount = results.filter((r) => r.pass).length;
  const summary = {
    total: results.length,
    passed: passCount,
    failed: results.length - passCount,
    workspace,
    results,
  };
  await writeEvidence("summary.json", JSON.stringify(summary, null, 2));

  console.log(
    `\n${passCount}/${results.length} assertions passed. Evidence in ${EVIDENCE}`,
  );
  if (passCount !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
