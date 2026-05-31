# Product Brief: Continue Locally — byte-exact sandbox ↔ local state handoff

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR

Let a user click **"Continue locally"** on a cloud session and get their branch, their full commit history, **and their exact in-progress edits** — staged, unstaged, brand-new untracked scratch files, deletions, executable bits, and binary bytes — landed byte-for-byte on their machine with one command. And the reverse: pick local work back up in a fresh sandbox. The POC proved this with stock `git bundle` plumbing and a three-tree capture trick, hitting byte-exact fidelity in both directions across seven independent fingerprints. The hard part isn't the commits (git already moves those well) — it's the uncommitted/untracked fidelity that naive `git diff`/`git stash` silently drops. That blind spot is eliminated. Feasibility: **Easy. Ship it.**

## The gap today

When a developer is mid-flow in a cloud session, the only way to get the work onto their machine is a commit and a PR/branch they then fetch and check out. That moves the *committed* history — but it abandons everything that makes a working session a working session:

- **Untracked scratch files vanish.** The half-written `scratch-notes.txt`, the throwaway repro script the user never `git add`-ed — gone. (Verified: plain `git stash create` doesn't capture untracked files at all.)
- **The staged-vs-unstaged split collapses.** A user who carefully staged part of a change and left the rest unstaged loses that distinction; on the other side it's all just "modified."
- **Deletions, exec bits, and binaries get mangled.** A textual patch loses untracked files, can corrupt binary assets, and is fragile across line-ending normalization.

Who feels it: **every developer who wants to finish in their own editor.** They're forced to either commit messy WIP just to transport it, or manually recreate their in-progress state locally. Both are friction at exactly the moment the agent has built up the most context. The pain is sharpest for the user who's been iterating for twenty minutes and just wants to "keep going in VS Code" without losing a single uncommitted edit.

## What we'd build

A **"Continue locally"** action on the session/diff view. The backend runs an export routine *inside the live sandbox* — a sequence of `exec`-able git commands — that captures the complete state into a single portable artifact, and the user runs one command locally to rehydrate it byte-exactly.

The proven mechanism (from the POC):

- **Transport is a single `git bundle`** — git's canonical offline, self-verifying, single-file transport for commit history, with thin-delta support (`<base>..<tip>`) for cheap "2 commits ahead" exports.
- **The crux — uncommitted capture via two extra trees written with plumbing.** Alongside `refs/handoff/head` (the HEAD commit), the export writes `refs/handoff/index` (`git write-tree` of the live index = the **staged** snapshot) and `refs/handoff/worktree` (`git add -A` into an **external throwaway index**, then `git write-tree` = **staged + unstaged + untracked**, with exec bits and binary bytes). From those three trees the importer reconstructs the exact split: HEAD→index = staged, index→worktree = unstaged, worktree-minus-HEAD = untracked/staged-new, HEAD-minus-worktree = working-tree deletions. A `.meta` sidecar makes import self-describing.
- **Restore is byte-exact** via `git checkout-index -a -f` through a throwaway index (restores exact bytes *and* modes, incl. the exec bit; binaries return byte-identical), then `git read-tree` points the real index at the staged snapshot.

The result the POC measured: after import, `git status -uall`, `git diff --cached`, `git diff`, the commit graph, and a sha256+mode manifest of every on-disk file are all **byte-identical** to the source — in both directions.

## How users experience it

### Where it lives (exposure)

- **Chat / session UI button: "Continue locally."** Lives on the session header or the diff view. One click triggers the export.
- **One-command local checkout.** The backend produces the bundle and hands the user a ready-to-run command: `continue-locally.sh <bundle> <cloneUrl> <dest>` — a fresh `git clone` + `import-state.sh`, exactly the flow proven in the POC. (Productized, this is wrapped by the same `bridge`/CLI as 3a, or a copy-pasteable snippet, so the user doesn't touch raw scripts.)
- **Reverse: "Resume in sandbox."** A local CLI runs the export on the user's working tree, uploads the bundle, and the orchestrator provisions a fresh sandbox clone and rehydrates it.
- **No daemon, no custom protocol, no persistent connection.** Unlike 3a, this is a one-shot artifact transfer. The only persistence needed already exists on the `sessions` table (`repoOwner`, `repoName`, `branch`, `cloneUrl`, `sandboxState`).

### Sample UI

**The export action:**

```
┌─ Session: fix-migration  (feature, 2 commits ahead of main) ─┐
│ The agent has uncommitted work in this sandbox:              │
│   • 1 staged change   • 1 unstaged change   • 1 new file     │
│   • 1 deletion        • run.sh (executable)  • logo.bin      │
│                                                             │
│            [ Continue locally ]   [ Open PR instead ]        │
└─────────────────────────────────────────────────────────────┘
```

**After clicking "Continue locally"** — a modal with the exact state being transported and a copy button:

```
Your branch + commits + ALL uncommitted edits will land byte-for-byte.

  $ curl -L <bundle-url> -o session.bundle
  $ open-agents continue-locally session.bundle

✓ includes untracked files (scratch-notes.txt)
✓ preserves staged vs. unstaged split
✓ exec bits + binary files byte-identical
⚠ 1 untracked file looks like a secret (.env) — review before transport
```

**On the local side**, the CLI prints a fidelity summary on completion: branch checked out, N commits fetched, staged/unstaged/untracked restored, and "working tree matches sandbox: ✓" derived from the same fingerprint check the eval uses.

### UX walkthrough

1. Developer has been iterating with the agent in a cloud session: a `feature` branch 2 commits ahead, a staged fix, a further unstaged tweak, a new untracked repro script, and a deleted obsolete file.
2. They decide to finish in their IDE. They click **"Continue locally."**
3. Backend runs the export inside the live sandbox (the git-bundle + three-tree capture), reads the `.bundle` + `.meta`, stores the bundle, and returns a one-line command.
4. Developer runs `open-agents continue-locally session.bundle` in their projects directory.
5. The CLI clones `cloneUrl`, fetches the bundle's refs, checks out `feature`, and rehydrates the working tree byte-exactly: staged change is staged, unstaged tweak is unstaged, the untracked script is present, the deletion is reflected, `run.sh` is still `755`, `logo.bin` is byte-identical.
6. They open the folder in their editor and keep going — `git status` looks exactly like it did in the sandbox.
7. (Reverse) Later they want cloud horsepower again: they run **"Resume in sandbox,"** their local WIP uploads, a fresh sandbox rehydrates to the same byte-exact state, and `sessions.branch`/`sandboxState` update.

## Value to the user

**Job to be done:** "Move my live, in-progress work between the cloud and my editor without losing a single uncommitted edit or having to commit messy WIP to transport it."

- **Resume-in-editor with zero loss (the core scenario).** The agent got me 80% there in the cloud; I want to finish the last mile in my own IDE with my own tooling — and I want my staged/unstaged/untracked state intact, not flattened. This is the whole point and the POC proves it works to the byte.
- **No more "commit just to move it."** Today the only transport is a commit. This lets a user move genuinely in-progress, uncommitted work — including scratch files they'd never want in history.
- **Round-trip between environments.** Start locally, push to a sandbox for a heavy build or a long agent run, pull it back — repeatedly — without the working state degrading on each hop.
- **Trustworthy hand-off.** Because fidelity is verifiable (the same seven fingerprints the eval checks), the user can trust that "Continue locally" means *exactly* this state, not an approximation.

## Value to the product

- **Differentiation on a real pain point.** "Continue locally — with your uncommitted edits intact" is a concrete, demoable capability that most cloud-agent products don't offer; the ones that do usually only move commits and quietly drop untracked/staged fidelity. We can show byte-exact fidelity on a deliberately nasty mixed state.
- **Activation/retention.** It removes the "I'm trapped in the cloud UI" feeling and lets users blend cloud and local fluidly. That fluidity makes the cloud session a natural *part* of a local workflow rather than a walled garden, which raises how often people reach for it.
- **Strategic positioning + downstream leverage.** The three-tree, git-bundle insight is a reusable primitive: the POC notes it feeds POC 4c, and it can supersede `packages/sandbox/git.ts`'s current per-file, hand-base64'd binary handling with git's own content-addressed transfer. One clean mechanism replaces a pile of special-casing and unlocks future state-portability features (snapshots, forking a session, sharing WIP).
- **Low cost, high polish.** Because it's stock git and no daemon, it's a high-leverage feature: small to build, hard to get wrong once the three-tree pattern is in place, and it makes the product feel notably more "real-developer-grade."

## The case FOR (strong)

1. **It's proven, byte-exact, and cheap.** The POC achieved byte-identical fidelity in *both* directions across seven independent fingerprints, on a state seeded with every nasty case at once (MM, A., .D, exec bit, binary, untracked, 2-ahead). The feasibility verdict is "Easy. Ship it." That's the rare combination of high user value and low build risk.
2. **It eliminates a blind spot competitors silently have.** The naive approaches (`git stash create`, `git diff`/`format-patch`, raw tarball) each drop untracked files, collapse the staged/unstaged split, or mangle binaries — and the POC verified each failure. Getting this *right* is a genuine, defensible quality difference.
3. **It uses stock git and the existing seam — no new infrastructure.** Every step is an `exec`-able git command fitting `Sandbox.exec(command, cwd, timeoutMs)`; the needed `sessions` columns already exist; no daemon, no custom protocol, no persistent socket. The integration is mechanical.
4. **It pays down existing tech debt.** It supersedes the per-file, manual base64 binary handling in `packages/sandbox/git.ts` with git's content-addressed transfer, and the three-tree insight feeds POC 4c. Building it makes adjacent code simpler, not more complex.
5. **It's far lower-risk than 3a while delivering much of the same "continue locally" promise.** No remote-exec, no daemon on the user's machine, no standing authority — just a one-shot artifact. For the "finish in my editor" job, this is the safer path to the same outcome.

## The case AGAINST (strong)

1. **The bundle is a sensitive artifact, and the most valuable thing it carries may be a secret.** Uncommitted `.env`/credential files that are *not* gitignored **will** be captured and transported in the bundle (the POC flags this explicitly). We'd be minting downloadable files that can contain live secrets. That demands encryption at rest, scoped/expiring access, and a pre-export secret scan with a loud warning — real work, and a real liability if mishandled.
2. **The "easy" verdict is for the happy path; the long tail is where it leaks.** Git LFS blob contents aren't in the bundle (only pointers), submodule working trees and their uncommitted state are out of scope, and device/socket/FIFO special files don't transfer. Multi-GB worktrees produce large, slow bundles. Each of these is a "but my repo…" support ticket and a place where "byte-exact" quietly becomes "byte-exact except." We'd need clear scoping, size guards, and honest UI about what's excluded.
3. **Cross-OS normalization can break the byte-exact promise.** The fidelity guarantee assumes consistent `core.autocrlf`/`core.fileMode` between sandbox and local. Windows locals in particular can mangle line endings and lose mode bits unless we pin these settings. "Byte-exact" that only holds on macOS/Linux is a footgun we'd have to manage carefully or scope out.
4. **`.gitignore`'d-but-important files won't transfer, and users won't expect that.** `git add -A` respects `.gitignore`, so an ignored-but-needed local config or generated file silently doesn't make the trip. Correct by default, surprising in practice — needs an `--include-ignored` opt-in with warnings, which adds surface area.
5. **Steelman "don't build it": maybe a commit is enough.** A disciplined user can `git add -A && git commit -m wip`, push, and check out locally — and arguably *should*, because transporting uncommitted state encourages messy, un-reviewed WIP to slosh between environments. One could argue the product should nudge users toward committing rather than building elaborate machinery to move uncommitted edits around. (Counter: the untracked-scratch-file and staged/unstaged-split cases genuinely don't survive a commit-based workflow, and forcing a commit is itself friction — but the "just commit" position is the honest minimal alternative.)

## Effort, dependencies & risk

- **Feasibility verdict (from the POC): Easy, and proven. "Ship it."** Full-fidelity handoff including the uncommitted/untracked blind spot works with stock git plumbing and nothing else — no daemon, no custom protocol — and is byte-exact in both directions.
- **Build size: small.** The export/import routines are sequences of git command strings that slot next to the existing helpers in `packages/sandbox/git.ts` as `exportHandoffBundle(sandbox)` / `importHandoffBundle(sandbox, bundle)`. The UI is one button + a modal + a CLI wrapper. Bundle storage reuses blob storage / a `snapshotUrl`-style field. The `sessions` schema already has `repoOwner`, `repoName`, `branch`, `cloneUrl`, `sandboxState`.
- **Dependencies & downstream value.** Runs on the existing sandbox `exec` seam (`packages/sandbox/interface.ts` → `vercel/sandbox.ts`). The **three-tree git-bundle insight feeds POC 4c** and supersedes `git.ts`'s manual per-file binary base64 handling. It can also share the 3a CLI as its delivery vehicle (the `continue-locally.sh` flow), though it does not require 3a's daemon or any remote-exec.
- **Top risks + mitigations** (from the POC): secrets in uncommitted files → encrypt the bundle at rest, scope/expire access, pre-export secret scan + warning; huge worktrees → delta bundles against the base ref + size guard; LFS → separate object fetch/transfer step (or clear "LFS blobs not included" notice); submodules → document as out-of-scope (gitlink SHA only); cross-OS EOL/mode → pin `core.autocrlf`/`core.fileMode` on both ends; gitignored-but-needed files → optional `--include-ignored` with loud warnings.

## The decision

**The crisp question:** Do we ship "Continue locally / Resume in sandbox" as a byte-exact, daemon-free state handoff — accepting that we must treat the bundle as a secret-bearing artifact and scope the LFS/submodule/cross-OS long tail honestly?

**Recommended trigger to greenlight:** Now. The mechanism is proven, the build is small, it reuses the existing seam and schema, and it pays down tech debt while feeding 4c. The only gating prerequisite is the **bundle-security story** (encrypted at rest, scoped/expiring URLs, pre-export secret scan/warning) — which should be a launch requirement, not a reason to delay scoping.

**Success metrics:** adoption rate of "Continue locally" per session; round-trip rate (sessions that go cloud→local→cloud); fidelity-failure rate reported by users (target ~0 on supported repos); reduction in "I lost my uncommitted work" / "I had to commit WIP to move it" complaints; and the share of users who do a *second* cloud session after a local detour (proof the round-trip is fluid).

**Suggested default: build now.** This is the high-value, low-risk member of the cloud↔local pair. It delivers the "finish in my editor" promise without any remote-exec attack surface, it's proven byte-exact, it's cheap, and it strengthens the platform's state-portability story for free. Pair its delivery CLI with 3a's bridge if/when 3a's diff-apply ships, but 3b stands fully on its own and should not wait on 3a.
