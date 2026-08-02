# UX Paths — Git & PR workflow

API-exercisable stories for the git/PR surface of Open Agents.

**Auth for all stories**: start the server with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`, call
`GET /api/dev/managed-runtime-demo` once, capture the `Set-Cookie`
(`open_agents_test_user_id=dev-managed-runtime-user`) and replay it on every request below.
Where a story says "authenticated", it means that cookie is attached.

**Route families in scope**

- `POST|GET /api/sessions/[sessionId]/git/pr`, `.../pr/generate`, `.../pr/readiness`,
  `.../pr/merge`, `.../pr/close`
- `POST /api/sessions/[sessionId]/git/branch`, `.../git/commit`, `.../git/discard`
- `GET /api/sessions/[sessionId]/git/status`, `.../git/deployment-url`
- `GET /api/sessions/[sessionId]/diff`, `.../diff/cached`, `.../diff/patch`
- `POST /api/sessions/[sessionId]/generate-commit-message`
- `POST /api/generate-pr`
- `POST /api/sessions/[sessionId]/checks/fix`
- `GET /api/github/branches`, `GET /api/repos/[owner]/[repo]/dashboard`
- Supporting: `POST /api/sessions`, `POST /api/sandbox`, `GET /api/sandbox/reconnect`,
  `POST /api/chat`, `GET /api/sessions/[sessionId]/files`, `.../files/content`

**Status-code contract** (from `app/api/sessions/[sessionId]/git/_lib/git-errors.ts`, verified by
`git-errors.test.ts`) — every `/git/*` route maps thrown action errors this way:

| Thrown message | HTTP |
|---|---|
| `Not authenticated` | 401 |
| `Forbidden` | 403 |
| `Session not found` | 404 |
| `Sandbox not initialized` / `Sandbox not active` | 409 |
| `Invalid …` (prefix), `Missing required fields`, `Branch name is required`, `Auto-merge is not available for draft pull requests` | 400 |
| anything else (incl. `No pull request found for this session`, `Session is not linked to a GitHub repository`, `Pull request is already merged`, `Failed to create branch: …`) | **500** |

Zod body-shape failures return `400 {error:"<first zod issue message>"}` before the action runs.

**Known redundancy (recorded, not resolved)**

1. Branch creation exists twice: `POST /api/sessions/[sessionId]/git/branch` and
   `POST /api/generate-pr` with `createBranchOnly:true`. Both resolve the live branch, auto-generate
   a name when on base/detached, and persist `session.branch`.
2. PR title/body generation exists twice: `POST /api/sessions/[sessionId]/git/pr/generate` and
   `POST /api/generate-pr` (without `createBranchOnly`). Both call
   `generatePullRequestContentFromSandbox`.
3. Their error contracts differ for the same failure: `/generate-pr` returns **400** for
   `Sandbox not initialized`, `/git/pr/generate` returns **409**; `/generate-pr` returns **403** for
   a foreign session, `/git/*` also returns 403 but only after `requireOwnedSession`.
4. Same data from multiple endpoints:
   - Current branch: `GET /git/status` (`status.branch`), `GET /git/pr` (`branch`),
     `GET /api/sessions/[sessionId]` (`session.branch`).
   - PR number/status: `GET /git/pr`, `GET /api/sessions/[sessionId]` (`session.prNumber`,
     `session.prStatus`), `GET /git/pr/readiness` (`pr.number`), and
     `GET /api/repos/[owner]/[repo]/dashboard` (`pullRequests[]`).
   - Uncommitted-change signal: `GET /git/status` (`hasUncommittedChanges`) and
     `GET /diff` (file list).
   - Diff content: `GET /diff` (JSON), `GET /diff/cached` (stale JSON), `GET /diff/patch` (text).

---

## STORY-git-and-pr-01: See where the working tree stands before touching anything

**Type**: short
**Persona**: Priya, a backend engineer resuming a session after lunch
**Goal**: Know the current branch, whether there are uncommitted changes, and whether a PR already exists
**Preconditions**: An authenticated session with an active sandbox on a cloned repo (created by STORY-git-and-pr-03 step 1–3, or any prior session)
**Ideal path**: 1 — a single "git state" read could return branch + dirty counts + PR status; today it takes 2 because branch/PR live in one route and working-tree counts in another.
**Alternate paths**: `GET /api/sessions/{sessionId}` returns `branch`, `prNumber`, `prStatus` from the DB without touching the sandbox; `GET /api/repos/vercel-labs/open-agents/dashboard` returns the repo's open PRs.

### Steps
1. `GET /api/sessions/ses_8fq2ab/git/status` → expect 200 `{status:{branch,isDetachedHead,hasUncommittedChanges,hasUnpushedCommits,stagedCount,unstagedCount,untrackedCount,uncommittedFiles}}`
2. `GET /api/sessions/ses_8fq2ab/git/pr` → expect 200 `{branch,prNumber,prStatus}` (`prStatus ∈ open|merged|closed|null`)

### Variations
- Sandbox stopped: `getGitStatus` throws `Sandbox not initialized` → `409`; but `GET /git/pr` degrades gracefully and returns the DB-cached `{branch,prNumber,prStatus}` with **200**. Same session state, two different contracts.
- Detached HEAD after a checkout of a SHA → `status.isDetachedHead:true`, `status.branch` is the short SHA.

### Edge Cases
- No cookie → `401 {error:"Not authenticated"}` on both.
- Foreign session id owned by another user → `404` (from `requireOwnedSession`, existence-hiding).
- Unknown session id `ses_doesnotexist` → `404 {error:"Session not found"}`.
- Session with no sandbox ever provisioned → `GET /git/status` `409 {error:"Sandbox not initialized"}`.

---

## STORY-git-and-pr-02: Review the diff three ways and pull a patch file

**Type**: short
**Persona**: Marco, reviewing what the agent changed before he lets it commit
**Goal**: Read the working-tree diff, open one changed file, and download a `.patch` to apply locally
**Preconditions**: Session with an active sandbox and uncommitted edits (STORY-git-and-pr-03 leaves this state)
**Ideal path**: 2 — one diff read plus one file read. The catalog exposes three diff representations, so a client that also wants the patch pays a third call.
**Alternate paths**: `GET /api/sessions/{id}/diff/cached` returns the same `DiffResponse` payload from cache with `{data,cachedAt,isStale:true}`; `GET /api/sessions/{id}/diff/patch` returns the same diff as `text/x-diff`. Three routes, one underlying computation.

### Steps
1. `GET /api/sessions/ses_8fq2ab/diff` → expect 200 `DiffResponse` with per-file entries
2. `GET /api/sessions/ses_8fq2ab/files` → expect 200 `{files:[...]}` (tracked + untracked)
3. `GET /api/sessions/ses_8fq2ab/files/content?path=apps/web/lib/git/http-schemas.ts` → expect 200 `{path,content,size}`
4. `GET /api/sessions/ses_8fq2ab/diff/patch` → expect 200 `text/x-diff` with `Content-Disposition: attachment`

### Variations
- Call `GET /diff/cached` first for an instant paint, then `GET /diff` to refresh — the two-stage pattern the UI uses.
- Clean tree: `GET /diff` returns 200 with an empty file list rather than an error.

### Edge Cases
- Sandbox not active → `GET /diff` and `GET /diff/patch` both `409`.
- `GET /diff/cached` with nothing cached → `404`.
- `GET /files/content` with no `path` query → `400`; nonexistent path → `404`; oversized file → `413`.
- Unauthenticated → `401` on all four.

---

## STORY-git-and-pr-03: First change to first PR — the happy path

**Type**: long
**Persona**: Priya, shipping a small fix to a repo she owns
**Goal**: Start a session, have the agent make an edit, branch, commit, generate a PR body, open the PR
**Preconditions**: GitHub App installed on `vercel-labs/open-agents`; repo on the user's allowlist
**Ideal path**: 8 — create session, provision sandbox, one chat turn, read diff, branch, commit, generate PR content, open PR. Everything beyond that (status polls, reconnect probes, base-branch lookup) is verification the API forces the client to do itself.
**Alternate paths**: Steps 6+8 can be replaced by `POST /api/generate-pr {createBranchOnly:true}` then `POST /api/generate-pr` (full) — a second, older path to the same branch+content result with different status codes.

### Steps
1. `POST /api/sessions` — body: `{"title":"Fix stale branch label in PR panel","repoOwner":"vercel-labs","repoName":"open-agents","repoUrl":"https://github.com/vercel-labs/open-agents.git","branch":"main"}` → expect 200/201 `{session:{id,...},chat:{id,...}}`
2. `GET /api/github/branches?owner=vercel-labs&repo=open-agents&limit=50` → expect 200 `{branches,defaultBranch:"main"}`
3. `POST /api/sandbox` — body: `{"sessionId":"ses_8fq2ab","repoUrl":"https://github.com/vercel-labs/open-agents.git","branch":"main"}` → expect 200 `{createdAt,timeout,currentBranch:"main",mode,timing}`
4. `POST /api/chat` — body: `{"sessionId":"ses_8fq2ab","chatId":"cht_1kd93","messages":[{"role":"user","parts":[{"type":"text","text":"In apps/web/components/pr-panel.tsx the branch label keeps showing the base branch after a new branch is created. Fix it and keep the existing tests passing."}]}]}` → expect 200 UI-message stream, header `x-workflow-run-id`
5. `GET /api/sessions/ses_8fq2ab/diff` → expect 200 `DiffResponse` listing `apps/web/components/pr-panel.tsx`
6. `POST /api/sessions/ses_8fq2ab/git/branch` — body: `{"sessionTitle":"Fix stale branch label in PR panel","baseBranch":"main","branchName":"HEAD"}` → expect 200 `{branchName:"priya/fix-stale-branch-label"}` (auto-generated because HEAD is on base)
7. `POST /api/sessions/ses_8fq2ab/generate-commit-message` → expect 200 `{message:"fix(pr-panel): show the newly created branch instead of the base branch"}`
8. `POST /api/sessions/ses_8fq2ab/git/commit` — body: `{"sessionTitle":"Fix stale branch label in PR panel","baseBranch":"main","branchName":"priya/fix-stale-branch-label","commitTitle":"fix(pr-panel): show the newly created branch","commitBody":"The panel rendered session.branch before the branch action resolved."}` → expect 200 `{committed:true,pushed:true,branchName:"priya/fix-stale-branch-label"}`
9. `GET /api/sessions/ses_8fq2ab/git/status` → expect 200 `status.hasUncommittedChanges:false`, `status.hasUnpushedCommits:false`
10. `POST /api/sessions/ses_8fq2ab/git/pr/generate` — body: `{"sessionTitle":"Fix stale branch label in PR panel","baseBranch":"main","branchName":"priya/fix-stale-branch-label"}` → expect 200 `{title,body,branchName}`
11. `POST /api/sessions/ses_8fq2ab/git/pr` — body: `{"repoUrl":"https://github.com/vercel-labs/open-agents.git","branchName":"priya/fix-stale-branch-label","title":"fix(pr-panel): show the newly created branch","body":"<generated body>","baseBranch":"main","isDraft":false}` → expect 200 `{success:true,prUrl,prNumber:1042,prStatus:"open"}`
12. `GET /api/sessions/ses_8fq2ab/git/pr` → expect 200 `{branch:"priya/fix-stale-branch-label",prNumber:1042,prStatus:"open"}`
13. `GET /api/sessions/ses_8fq2ab/git/deployment-url?prNumber=1042` → expect 200 deployment-url result

### Variations
- Open as draft: step 11 with `"isDraft":true` → PR opens draft; combining `isDraft:true` with `shouldAutoMerge:true` is rejected (see edge cases).
- Fork workflow: step 11 with `"headOwner":"priya-dev"` when the branch lives on a fork.
- Skip step 10 and write the title/body by hand — `/git/pr` does not require generated content.

### Edge Cases
- Step 6 with `"branchName":""` → `400 {error:...}` from `createBranchRequestSchema` (`nonEmpty`).
- Step 6 with `"baseBranch":"ma in"` → `400 {error:"Invalid base branch name"}`.
- Step 8 while the sandbox has expired → `409 {error:"Sandbox not initialized"}`.
- Step 11 with `"repoUrl":"not-a-url"` → action throws `Invalid repository URL` → `400`.
- Step 11 with `"isDraft":true,"shouldAutoMerge":true` → `400 {error:"Auto-merge is not available for draft pull requests"}`.
- Step 11 with `title` missing → `400` (zod, before any GitHub call).
- Step 11 when the GitHub App lacks write access to `vercel-labs/open-agents` → `getRepoAccessErrorMessage(...)` is thrown and **not** in the mapped list → `500`.
- Any step without the auth cookie → `401 {error:"Not authenticated"}`.

---

## STORY-git-and-pr-04: The legacy one-shot PR route

**Type**: short
**Persona**: A client still on the older PR button
**Goal**: Branch and generate PR content through `/api/generate-pr`
**Preconditions**: Session with active sandbox and committed work on a feature branch (STORY-git-and-pr-03 steps 1–8)
**Ideal path**: 1 — this route already does branch-resolution + content generation in one call, which is why it duplicates two `/git/*` routes.
**Alternate paths**: `POST /api/sessions/{id}/git/branch` + `POST /api/sessions/{id}/git/pr/generate` reach the identical result. **Duplicate recorded.**

### Steps
1. `POST /api/generate-pr` — body: `{"sessionId":"ses_8fq2ab","sessionTitle":"Fix stale branch label in PR panel","baseBranch":"main","branchName":"HEAD","createBranchOnly":true}` → expect 200 `{branchName:"priya/fix-stale-branch-label"}`
2. `POST /api/generate-pr` — body: `{"sessionId":"ses_8fq2ab","sessionTitle":"Fix stale branch label in PR panel","baseBranch":"main","branchName":"priya/fix-stale-branch-label"}` → expect 200 `{title,body,branchName}`

### Variations
- Call step 2 directly on a session already on a feature branch — the route re-resolves the live branch from `git symbolic-ref --short HEAD` and ignores a stale `branchName`.

### Edge Cases
- Uncommitted changes present → `400 {error:"Uncommitted changes — commit first before generating PR content"}` (no equivalent guard message on `/git/pr/generate`).
- Sandbox not active → `400 {error:"Sandbox not initialized"}` — note `/git/pr/generate` returns **409** for the same condition.
- Session owned by another user → `403 {error:"Forbidden"}`; unknown session → `404 {error:"Session not found"}`.
- Missing `sessionId` → `400 {error:"Session ID is required"}`; malformed JSON → `400 {error:"Invalid JSON body"}`.
- More than 5 calls in 60s for one user → rate-limit response from `checkRateLimit`.
- Bot-protection trip → `403 {error:"Access denied"}`.

---

## STORY-git-and-pr-05: Merge readiness, then squash-merge and delete the branch

**Type**: medium
**Persona**: Marco, merging his own PR once CI is green
**Goal**: Confirm the PR can merge, merge it with squash, delete the branch
**Preconditions**: PR 1042 open on the session (STORY-git-and-pr-03)
**Ideal path**: 2 — readiness then merge. The extra polling calls exist because readiness is a snapshot with no subscription.
**Alternate paths**: `GET /api/repos/vercel-labs/open-agents/dashboard` surfaces the same PR + Actions state in aggregate; `GET /api/github/repos/vercel-labs/open-agents/actions/runs?branch=priya/fix-stale-branch-label` returns the same check runs from the Actions side.

### Steps
1. `GET /api/sessions/ses_8fq2ab/git/pr/readiness` → expect 200 `{canMerge:false,reasons:["Required checks are still running"],pr:{number:1042,repo,title,body,baseBranch:"main",headBranch,headSha,additions,deletions,changedFiles,commits},allowedMethods:["merge","squash","rebase"],checks:{requiredTotal,passed,pending,failed}}`
2. `GET /api/sessions/ses_8fq2ab/git/pr/readiness` (poll ~30s later) → expect 200 `canMerge:true`, `checks.pending:0`
3. `POST /api/sessions/ses_8fq2ab/git/pr/merge` — body: `{"mergeMethod":"squash","commitTitle":"fix(pr-panel): show the newly created branch (#1042)","commitMessage":"Resolves the stale base-branch label after branch creation.","deleteBranch":true,"expectedHeadSha":"9c1f4b2e7a0d5c33e8b1a6f4d2c9e7b5a3f1d0c8"}` → expect 200 `{merged:true,prNumber:1042,mergeCommitSha,branchDeleted:true,branchDeleteError:null}`
4. `GET /api/sessions/ses_8fq2ab/git/pr` → expect 200 `{branch,prNumber:1042,prStatus:"merged"}`

### Variations
- `"mergeMethod":"rebase"` when the repo allows it; omit `mergeMethod` to take the repo default.
- `"force":true` to bypass the readiness reasons the action would otherwise raise.
- `"deleteBranch":false` to keep the branch for follow-up work.

### Edge Cases
- `"mergeMethod":"octopus"` → `400` from `mergePrRequestSchema` enum.
- `"expectedHeadSha":"nope"` → action throws `Invalid expected head SHA` → `400`.
- Head moved since step 2 (someone pushed) → SHA mismatch → thrown reason, not in the mapped list → `500`.
- Session has no `prNumber` → `No pull request found for this session` → **500** (should arguably be 404 — recorded).
- Session not linked to a repo → `Session is not linked to a GitHub repository` → **500**.
- PR already closed → `Pull request is closed` → **500**.
- Repo disallows squash → `Selected merge method is not allowed for this repository` → **500**.
- Unauthenticated → `401`; another user's session → `403`.

---

## STORY-git-and-pr-06: Abandon the change — discard, then close the PR

**Type**: medium
**Persona**: Priya, whose approach turned out to be wrong
**Goal**: Throw away working-tree edits and close the PR she opened
**Preconditions**: Session with uncommitted edits and PR 1042 open
**Ideal path**: 2 — discard, close. The status/diff reads around them are confidence checks the API doesn't fold in.
**Alternate paths**: none found for closing; discarding a single file has no alternative route.

### Steps
1. `GET /api/sessions/ses_8fq2ab/git/status` → expect 200 `status.hasUncommittedChanges:true`
2. `POST /api/sessions/ses_8fq2ab/git/discard` — body: `{"filePath":"apps/web/components/pr-panel.tsx"}` → expect 200 discard result
3. `POST /api/sessions/ses_8fq2ab/git/discard` — body: `{}` → expect 200 (discard everything)
4. `GET /api/sessions/ses_8fq2ab/diff` → expect 200 with an empty file list
5. `POST /api/sessions/ses_8fq2ab/git/pr/close` → expect 200 `{closed:true,prNumber:1042}`
6. `GET /api/sessions/ses_8fq2ab/git/pr` → expect 200 `{branch,prNumber:1042,prStatus:"closed"}`

### Variations
- Discard a rename: `{"filePath":"apps/web/components/pr-panel.tsx","oldPath":"apps/web/components/pull-request-panel.tsx"}`.
- Close-then-reopen is not supported by any route — reopening requires opening a new PR via `POST /git/pr`.

### Edge Cases
- `{"oldPath":"apps/web/old.tsx"}` with no `filePath` → `400 {error:"filePath is required when oldPath is provided"}`.
- Step 5 repeated → the action short-circuits on `prStatus:"closed"` and returns `200 {closed:true,prNumber:1042}` (idempotent, no GitHub call).
- Step 5 on an already-merged PR → `Pull request is already merged` → **500**.
- Step 5 on a session with no PR → `No pull request found for this session` → **500**.
- Sandbox gone at step 2 → `409 {error:"Sandbox not initialized"}`.
- Unauthenticated → `401`.

---

## STORY-git-and-pr-07: Multi-turn — CI fails, the agent fixes it, the PR merges

**Type**: long
**Persona**: Priya, iterating with the agent against red CI on her open PR
**Goal**: Get failing checks explained, feed them back to the agent, land the follow-up commit, merge
**Preconditions**: PR 1042 open with a failing check run (STORY-git-and-pr-03 completed and CI has run)
**Ideal path**: 6 — read checks, build fix prompt, one chat turn, commit, readiness, merge. The real path is longer because check status, log compaction, and the chat turn are three separate surfaces.
**Alternate paths**: `GET /api/github/repos/vercel-labs/open-agents/actions/runs/{runId}/jobs` plus `GET .../actions/jobs/{jobId}/logs` returns the same raw logs `checks/fix` compacts with an LLM — the manual version of the same journey. `POST /api/github/repos/vercel-labs/open-agents/actions/runs/{runId}/rerun?onlyFailed=1` reaches "green CI" without changing code at all.

### Steps
1. `GET /api/sessions/ses_8fq2ab/git/pr/readiness` → expect 200 `canMerge:false`, `checks.failed:1`
2. `GET /api/github/repos/vercel-labs/open-agents/actions/runs?branch=priya/fix-stale-branch-label&status=completed&per_page=10` → expect 200 `{ok:true,runs:[...]}`
3. `GET /api/github/repos/vercel-labs/open-agents/actions/runs/17482991045/jobs` → expect 200 `{ok:true,jobs:[{id:52310448821,name:"ci / test",conclusion:"failure"}]}`
4. `POST /api/sessions/ses_8fq2ab/checks/fix` — body: `{"checkRuns":[{"name":"ci / test","conclusion":"failure","detailsUrl":"https://github.com/vercel-labs/open-agents/actions/runs/17482991045/job/52310448821"}]}` → expect 200 `{prompt,snippets:[{filename,content}]}`
5. `POST /api/chat` — body: `{"sessionId":"ses_8fq2ab","chatId":"cht_1kd93","messages":[{"role":"user","parts":[{"type":"text","text":"<prompt from step 4>"}]}]}` → expect 200 UI-message stream (tool calls: read file, edit, run `bun test`)
6. `GET /api/sessions/ses_8fq2ab/diff` → expect 200 showing the follow-up edit
7. `POST /api/sessions/ses_8fq2ab/generate-commit-message` → expect 200 `{message:"test(pr-panel): assert branch label updates after branch creation"}`
8. `POST /api/sessions/ses_8fq2ab/git/commit` — body: `{"sessionTitle":"Fix stale branch label in PR panel","baseBranch":"main","branchName":"priya/fix-stale-branch-label","commitTitle":"test(pr-panel): assert branch label updates after branch creation"}` → expect 200 `{committed:true,pushed:true,branchName:"priya/fix-stale-branch-label"}`
9. `GET /api/sessions/ses_8fq2ab/git/pr/readiness` → expect 200 `checks.pending:1`, `canMerge:false`
10. `POST /api/chat` — body: same shape, text `"While CI reruns, summarize what was actually broken in one paragraph for the PR description."` → expect 200 stream
11. `GET /api/sessions/ses_8fq2ab/git/pr/readiness` (poll) → expect 200 `canMerge:true`
12. `POST /api/sessions/ses_8fq2ab/git/pr/merge` — body: `{"mergeMethod":"squash","deleteBranch":true}` → expect 200 `{merged:true,prNumber:1042,mergeCommitSha,branchDeleted:true,branchDeleteError:null}`
13. `GET /api/sessions/ses_8fq2ab/git/deployment-url?prNumber=1042` → expect 200 deployment-url result
14. `GET /api/repos/vercel-labs/open-agents/dashboard` → expect 200 aggregate with PR 1042 no longer in the open list

### Variations
- Interrupt the agent mid-turn: `POST /api/chat/cht_1kd93/stop` → `200 {success:true}`, then reconnect with `GET /api/chat/cht_1kd93/stream`.
- Instead of steps 5–8, rerun only the failed jobs:
  `POST /api/github/repos/vercel-labs/open-agents/actions/runs/17482991045/rerun?onlyFailed=1` → `202 {ok:true,action:"rerun",runId:17482991045}`.
- Cancel a stuck run: `POST /api/github/repos/vercel-labs/open-agents/actions/runs/17482991045/cancel` → `202`.

### Edge Cases
- Step 4 with 11 entries in `checkRuns` → `400` (MAX_CHECK_RUNS = 10).
- Step 4 with `{}` → `400`.
- Step 4 when logs can't be fetched → still `200`, snippet content is `"(Unable to fetch logs)"`.
- Step 5 on a chat that belongs to another session → `403`.
- Step 8 when the remote branch moved and push is rejected → `commitChanges` returns `200` with `{committed:true,pushed:false,error:"..."}` — a failure delivered as a 200 body, unlike every other git route.
- Steps 2/3 without repo read access → `403` from `verifyRepoAccess`.
- Unauthenticated on any step → `401`.

---

## STORY-git-and-pr-08: Branch off an existing feature branch, not main

**Type**: medium
**Persona**: Marco, stacking a second change on a colleague's in-review branch
**Goal**: Start work from `feat/session-git-http-routes` rather than `main`
**Preconditions**: Authenticated user with GitHub App access to the repo
**Ideal path**: 4 — list branches, create session on the base, provision sandbox, create the new branch.
**Alternate paths**: `POST /api/sandbox` accepts `{"branch":"...","isNewBranch":true}`, creating the branch at provisioning time and skipping the `/git/branch` call entirely. **Duplicate recorded.**

### Steps
1. `GET /api/github/branches?owner=vercel-labs&repo=open-agents&query=feat/&limit=25` → expect 200 `{branches:["feat/session-git-http-routes",...],defaultBranch:"main"}`
2. `POST /api/sessions` — body: `{"title":"Add readiness caching on top of the git HTTP routes","repoOwner":"vercel-labs","repoName":"open-agents","repoUrl":"https://github.com/vercel-labs/open-agents.git","branch":"feat/session-git-http-routes"}` → expect 200/201 `{session,chat}`
3. `POST /api/sandbox` — body: `{"sessionId":"ses_c31mq7","repoUrl":"https://github.com/vercel-labs/open-agents.git","branch":"feat/session-git-http-routes"}` → expect 200 `{currentBranch:"feat/session-git-http-routes",...}`
4. `POST /api/sessions/ses_c31mq7/git/branch` — body: `{"sessionTitle":"Add readiness caching","baseBranch":"feat/session-git-http-routes","branchName":"marco/readiness-cache"}` → expect 200 `{branchName:"marco/readiness-cache"}`
5. `GET /api/sessions/ses_c31mq7/git/status` → expect 200 `status.branch:"marco/readiness-cache"`
6. Later, open the PR against the stack base: `POST /api/sessions/ses_c31mq7/git/pr` — body: `{"repoUrl":"https://github.com/vercel-labs/open-agents.git","branchName":"marco/readiness-cache","title":"perf(git): cache merge readiness for 15s","baseBranch":"feat/session-git-http-routes"}` → expect 200 `{success:true,prUrl,prNumber,prStatus:"open"}`

### Variations
- Step 1 with no `query` returns the full first page — used to populate a base-branch picker.
- Provision with `isNewBranch:true` at step 3 and drop step 4.

### Edge Cases
- Step 1 missing `owner` or `repo` → `400`.
- Step 1 unauthenticated → falls back to public listing or `401` depending on repo visibility (route documents both `401` and `500`).
- Step 4 with `"branchName":"marco/readiness cache"` (space) → `400 {error:"Invalid branch name"}`.
- Step 4 when the branch already exists in the sandbox → `git checkout -b` fails → `Failed to create branch: ...` → **500**.
- Step 6 with `baseBranch` that no longer exists on the remote → GitHub error surfaces as **500**.

---

## STORY-git-and-pr-09: Draft PR with auto-merge armed for later

**Type**: medium
**Persona**: Priya, opening early for visibility but wanting it to land itself once green
**Goal**: Open a draft, mark it ready by opening a non-draft PR with auto-merge, verify auto-merge state
**Preconditions**: Committed work on `priya/telemetry-events`, sandbox active
**Ideal path**: 2 — open, then flip ready + arm auto-merge. There is no "mark ready for review" route, so the second half of this journey has no clean API expression.
**Alternate paths**: none found for undrafting — the only PR-mutating routes are open, merge, close.

### Steps
1. `POST /api/sessions/ses_p9x4tt/git/pr` — body: `{"repoUrl":"https://github.com/vercel-labs/open-agents.git","branchName":"priya/telemetry-events","title":"feat(observability): emit git action telemetry","body":"Draft — wiring events, not ready for review.","baseBranch":"main","isDraft":true}` → expect 200 `{success:true,prUrl,prNumber:1051,prStatus:"open"}` (no `autoMergeEnabled` key, because `shouldAutoMerge` was absent)
2. `GET /api/sessions/ses_p9x4tt/git/pr/readiness` → expect 200 `canMerge:false`, `reasons` includes the draft state
3. `POST /api/sessions/ses_p9x4tt/git/pr` — body: `{"repoUrl":"https://github.com/vercel-labs/open-agents.git","branchName":"priya/telemetry-events","title":"feat(observability): emit git action telemetry","body":"Adds structured events for branch/commit/PR actions.","baseBranch":"main","isDraft":false,"shouldAutoMerge":true}` → expect 200 `{success:true,prUrl,prNumber,prStatus:"open",autoMergeEnabled:true,autoMergeError:null}`
4. `GET /api/sessions/ses_p9x4tt/git/pr` → expect 200 `{branch:"priya/telemetry-events",prNumber,prStatus:"open"}`

### Variations
- Repo without auto-merge enabled → step 3 still `200` but `{autoMergeEnabled:false,autoMergeError:"..."}` — a partial failure inside a success body.

### Edge Cases
- `{"isDraft":true,"shouldAutoMerge":true}` → `400 {error:"Auto-merge is not available for draft pull requests"}`.
- `"branchName":""` → `400` (zod `nonEmpty`).
- `"headOwner":"bad owner"` → `Invalid head owner` → `400`.
- Repo access revoked between steps 1 and 3 → `500`.

---

## STORY-git-and-pr-10: Recover a stale session and finish the PR

**Type**: medium
**Persona**: Marco, returning the next morning to a session whose sandbox timed out
**Goal**: Discover the sandbox is dead, resume it, and merge the PR that was already open
**Preconditions**: Session with PR 1042 open and an expired sandbox (state left by STORY-git-and-pr-03)
**Ideal path**: 3 — probe, resume, merge. The extra calls exist because the 409/200 split between sandbox-dependent and DB-backed git routes has to be discovered by trial.
**Alternate paths**: `GET /api/sandbox/status?sessionId=...` and `GET /api/sandbox/reconnect?sessionId=...` both report liveness; `POST /api/sandbox/extend` avoids the expiry entirely if called before timeout.

### Steps
1. `GET /api/sessions/ses_8fq2ab/git/status` → expect **409** `{error:"Sandbox not initialized"}`
2. `GET /api/sessions/ses_8fq2ab/git/pr` → expect **200** `{branch,prNumber:1042,prStatus:"open"}` (DB fallback, no sandbox needed)
3. `GET /api/sandbox/reconnect?sessionId=ses_8fq2ab` → expect 200 `{status,hasSnapshot,lifecycle,...}`
4. `POST /api/sandbox` — body: `{"sessionId":"ses_8fq2ab","repoUrl":"https://github.com/vercel-labs/open-agents.git","branch":"priya/fix-stale-branch-label"}` → expect 200 `{currentBranch:"priya/fix-stale-branch-label",mode,timing}`
5. `GET /api/sessions/ses_8fq2ab/git/status` → expect 200 `{status:{branch:"priya/fix-stale-branch-label",...}}`
6. `GET /api/sessions/ses_8fq2ab/git/pr/readiness` → expect 200 with `pr.number:1042`
7. `POST /api/sessions/ses_8fq2ab/git/pr/merge` — body: `{"mergeMethod":"squash","deleteBranch":true}` → expect 200 `{merged:true,prNumber:1042,...}`

### Variations
- Skip steps 3–5: merge and close do **not** need a live sandbox (they only read the DB + GitHub), so step 7 succeeds straight after step 2. Steps 1–5 are wasted work a client can't know to skip from the API alone.
- Extend instead of rebuild: `POST /api/sandbox/extend` with `{"sessionId":"ses_8fq2ab"}` while still alive.

### Edge Cases
- Step 4 on a session whose repo access was revoked → `403`.
- `POST /api/sessions/{id}/generate-commit-message` on the dead sandbox → `400 {error:"No active sandbox"}` — a **different** code than `/git/status`'s `409` for the same condition.
- `GET /api/sessions/{id}/diff/cached` on the dead sandbox → `200` with `isStale:true` if a cached diff exists, `404` otherwise.
- Unknown session id on any step → `404`.

---

## STORY-git-and-pr-11: Validation sweep across every git route

**Type**: medium
**Persona**: An API-contract test suite
**Goal**: Confirm each git route rejects malformed input before doing sandbox or GitHub work
**Preconditions**: One authenticated session with an active sandbox (`ses_8fq2ab`)
**Ideal path**: 7 — one deliberate rejection per mutating route.
**Alternate paths**: none found.

### Steps
1. `POST /api/sessions/ses_8fq2ab/git/branch` — body: `{"sessionTitle":"x","baseBranch":"","branchName":"marco/test"}` → expect `400`
2. `POST /api/sessions/ses_8fq2ab/git/commit` — body: `{"sessionTitle":"x","baseBranch":"main"}` (no `branchName`) → expect `400`
3. `POST /api/sessions/ses_8fq2ab/git/discard` — body: `{"oldPath":"apps/web/old.tsx"}` → expect `400 {error:"filePath is required when oldPath is provided"}`
4. `POST /api/sessions/ses_8fq2ab/git/pr` — body: `{"baseBranch":"main","title":"t"}` (no `repoUrl`) → expect `400`
5. `POST /api/sessions/ses_8fq2ab/git/pr/merge` — body: `{"mergeMethod":"fast-forward"}` → expect `400`
6. `GET /api/sessions/ses_8fq2ab/git/deployment-url?prNumber=-3` → expect `400 {error:...}` (positive int required)
7. `GET /api/sessions/ses_8fq2ab/git/deployment-url?branch=` → expect `400` (`nonEmpty`)
8. `POST /api/sessions/ses_8fq2ab/git/pr/generate` — body: `not json` → `readJsonBody` returns null → zod fails → expect `400`

### Variations
- Repeat every step with no auth cookie → all return `401` before validation runs (the gate precedes the zod parse).
- Repeat every step against `ses_doesnotexist` → all `404`.

### Edge Cases
- `GET /api/sessions/ses_8fq2ab/git/deployment-url` with neither `prNumber` nor `branch` → both optional, so `200` (or the action's own error) — no validation stops an empty query.
- `POST /api/sessions/ses_8fq2ab/git/discard` with an empty body `{}` → valid, discards everything. Easy to trigger accidentally by sending no body at all.

---

## STORY-git-and-pr-12: Repo-level PR overview instead of session-level

**Type**: short
**Persona**: Marco, checking what's in flight across the repo before starting new work
**Goal**: See open PRs, issues, Actions state, and agent runs for one repo in one place
**Preconditions**: GitHub App installed on `vercel-labs/open-agents`
**Ideal path**: 1 — the dashboard route already aggregates it.
**Alternate paths**: The same PR list is reachable per-session via `GET /api/sessions/{id}/git/pr` (one PR at a time) and the Actions half via `GET /api/github/repos/{owner}/{repo}/actions/runs`. **Overlap recorded.**

### Steps
1. `GET /api/repos/vercel-labs/open-agents/dashboard` → expect 200 aggregate `{pullRequests,issues,actions,agents,runs,readiness}`
2. `GET /api/github/repos/vercel-labs/open-agents/actions/readiness` → expect 200 `{ok,readiness,defaultBranch:"main"}`

### Variations
- Repo with no GitHub App installation → `200` with a `DashboardErrorKind` of `installation_missing` rather than an error status.
- App installed but without access to this repo → dashboard error kind `app_no_access`.

### Edge Cases
- Unauthenticated → `401`.
- Repo the user cannot read → dashboard degrades to an error-kind payload; the Actions readiness route returns `403`.
- Nonexistent repo `vercel-labs/not-a-repo` → dashboard returns a populated error kind, not `404` — inconsistent with the session-scoped routes' existence-hiding `404`.
