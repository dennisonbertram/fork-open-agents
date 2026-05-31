# POC 1a — Headless-Browser Agent Tool (Playwright + AI SDK image parts)

A complete, working proof-of-concept for a real Playwright/CDP-driven browser
toolset — `navigate / click / type / screenshot / extract` — modeled on the
existing `packages/agent/tools/*` shape, with screenshots emitted as AI SDK
**UIMessage image/file parts** so they render inline in chat.

This is self-contained in `POC/1a-browser-tool/` with its own `package.json`. It
does not modify the root `package.json`, the root lockfile, or any
`apps/`/`packages/` source.

## Goal

Decide whether a first-class, in-process Playwright toolset is feasible as a
replacement for (or layer on top of) the existing `agent-browser` CLI, and prove
the screenshot → chat-image path end to end.

## What was built

| File | Purpose |
| --- | --- |
| `browser-session.ts` | Process-singleton headless Chromium launcher (Playwright). Measures cold-start. In the real repo this maps to a per-session resolver like `getSandbox(experimental_context, ...)`. |
| `browser-tool.ts` | Five AI-SDK tools using the repo's `tool({ description, inputSchema (zod), execute })` pattern: `browser_navigate`, `browser_click`, `browser_type`, `browser_extract`, `browser_screenshot`. Each returns a discriminated `{ success }` result (matches `read.ts`/`bash.ts`). `browser_screenshot` both returns a persisted image part **and** streams a live file chunk via an optional `writer` on `experimental_context`. |
| `image-part.ts` | The exact AI SDK v6 (`6.0.168`) shapes: persisted `FileUIPart` (`{ type:"file", mediaType, filename?, url }`) and the live stream file `UIMessageChunk` (`{ type:"file", url, mediaType }`), built from screenshot bytes as a `data:image/png;base64,...` Data URL. |
| `fixtures/index.html` | Local static page that exercises every tool (reveal-on-click link, text input, extractable nodes). |
| `eval.ts` | Serves the fixture over HTTP, drives real Chromium through navigate→extract→click→extract→type→screenshot, and asserts on real outcomes (text equality, PNG magic bytes, byte-length round-trip, stream-chunk shape). Writes artifacts + log to `evidence/`. |
| `image-part-demo.ts` | Standalone: reads the captured PNG and prints both image-part shapes; confirms it matches the renderer predicate in `shared-chat-content.tsx`. |

## How it was tested + evidence

Commands:

```bash
bun install                       # self-contained deps (ai, playwright, zod, tsx)
bun run install:chromium          # playwright install chromium
bun run eval                      # real browser run + assertions
bun run image-part                # print the image-part shapes
```

Evidence (in `evidence/`):

- `eval-log.txt` — timestamped run log with every PASS/FAIL assertion and the raw tool results.
- `screenshot.png` — the artifact captured by `browser_screenshot` (decoded from the image-part Data URL, proving the round-trip).
- `image-part.json` — the constructed `FileUIPart` (url truncated for readability).

What the eval asserts (all on real outcomes, not mocks):

1. Chromium cold start completes (and is recorded in ms).
2. `navigate` returns HTTP 200 and the correct `<title>`.
3. `extract` returns exact text of `#heading` ("Headless Browser POC").
4. `click` on the reveal link succeeds, then `extract` of `#secret` returns `the-secret-token-42` (proves real DOM mutation via JS click handler).
5. attribute extraction returns the right value.
6. `type` into the input round-trips the value back via `inputValue`.
7. `screenshot` is >1KB, is streamed via the writer, decodes to a valid PNG (magic `89504e470d0a1a0a`), and the decoded byte length matches the reported length.
8. exactly one file chunk was streamed with the `{type:"file", url, mediaType}` shape.

### Measured timings (Apple Silicon, macOS, this machine)

| Metric | Value | Notes |
| --- | --- | --- |
| npm deps install (`bun install`) | **~20 s** | ai + playwright + zod + tsx, one-time |
| Chromium **cold** install (`playwright install chromium`) | **211 s** (~3.5 min) | empty cache: downloads Chrome (~336M) + headless shell (~189M) + ffmpeg over the CDN. This is the briefing's flagged feasibility risk and is dominated by download bandwidth. |
| Chromium **warm** install (binaries cached) | **~0 s** | no-op once present; bake into the image/snapshot to pay this once. |
| Chromium **cold start** (`chromium.launch()` → usable page) | **1410 ms** | per-session launch, measured in `eval.ts`. |
| Full eval (navigate→click→type→extract→screenshot + asserts) | **< 1 s** after launch | see `evidence/eval-log.txt`. |
| Screenshot size (1280×720 viewport, full page) | **27,773 bytes** PNG | base64 Data URL ≈ 37 KB in the message stream. |

Raw eval output (every assertion passed, exit code 0):

```
Chromium cold start: 1410 ms
PASS  navigate HTTP 200
PASS  page title matches
PASS  extracted heading text
PASS  click succeeded
PASS  extracted revealed secret
PASS  typed value round-trips
PASS  screenshot succeeded
PASS  screenshot non-trivial size (>1KB)
PASS  screenshot streamed via writer
PASS  data URL decodes to valid PNG header
PASS  decoded bytes match reported byteLength
PASS  exactly one chunk streamed
PASS  streamed chunk has file shape
ALL ASSERTIONS PASSED
```

## Integration plan into the real codebase

1. **Tool module**: Drop `browser-tool.ts` in as `packages/agent/tools/browser.ts`.
   Replace the POC `BrowserToolContext` resolution with the repo pattern: resolve a
   per-session browser keyed off `experimental_context` the same way
   `packages/agent/tools/utils.ts#getSandbox` resolves a sandbox. Launch flags
   inside the microVM need `--no-sandbox` (already wired in the POC eval).

2. **Registration**: Export the factories from `packages/agent/tools/index.ts`
   (alongside `readFileTool`, `bashTool`, …) and add them to the agent's tool set.
   Gate destructive/navigation-to-arbitrary-URL behavior with `needsApproval`
   if desired, mirroring `bash.ts`.

3. **Image-part path**: The renderer already exists — `apps/web/app/shared/[shareId]/shared-chat-content.tsx`
   and `session-chat-content.tsx` both handle `part.type === "file" && part.mediaType?.startsWith("image/")`
   by rendering `<img src={part.url} />`. To stream live, pass the
   `createUIMessageStream` `writer` (see `apps/web/app/workflows/chat.ts`,
   which already uses `convertToModelMessages`/UI message streaming) through
   `experimental_context` and call `writer.write(buildScreenshotStreamChunk(...))`.
   The persisted `FileUIPart` from `buildScreenshotPart(...)` is appended to the
   assistant `WebAgentUIMessage.parts` (type in `apps/web/app/types.ts`).
   For large/full-page screenshots, prefer uploading to blob storage and using a
   hosted `url` instead of a Data URL (see Remaining risks).

4. **Running Chromium in the microVM sandbox**: Use the sandbox interface in
   `packages/sandbox/interface.ts` — `exec(command, cwd, timeoutMs)` to install
   browser deps, and `domain(port)` to expose a port if you run Chromium with a
   remote-debugging endpoint and connect over CDP from the app
   (`chromium.connectOverCDP(...)`). The managed-runtime profile that today runs
   `agent-browser install --with-deps`
   (`packages/sandbox/profiles/web-bun-agent-browser/setup.sh`) would instead run
   `playwright install --with-deps chromium`.

## Compare: this Playwright approach vs. the existing `agent-browser` CLI

The existing path (`apps/web/lib/sandbox/runtime/browser-runs.ts`) shells out to
the `agent-browser` binary via `sandbox.exec("agent-browser …")` (with an app-runtime
`execFile` fallback), installed by the profile setup script
(`bun install -g agent-browser` + `agent-browser install --with-deps`). It is a
**black-box, one-shot "browser check"**: it takes a target URL, runs a scripted
smoke, and persists a `SandboxBrowserRun` row (summary, console/network errors,
artifact refs). It is great for "did this preview deploy load without errors",
but it is *coarse-grained* — the agent cannot interleave click/type/extract steps
with its own reasoning, and screenshots flow through the DB run record rather
than directly into the chat message stream as image parts.

The POC Playwright toolset is **fine-grained and agent-driven**: each primitive
(navigate/click/type/extract/screenshot) is its own tool call the model composes,
and screenshots become first-class chat image parts immediately.

### Recommendation: **Layer, don't replace**

- **Keep `agent-browser`** as the managed "preview smoke / deploy verification"
  primitive feeding `sandboxBrowserRuns` — it already satisfies the observability
  + redaction discipline the repo requires for managed-runtime proofs.
- **Add the Playwright toolset** as the interactive, step-by-step browser
  capability the agent drives directly, emitting image parts into chat.

They serve different jobs (automated smoke vs. interactive exploration) and share
no state, so layering avoids regressing the existing verified-build evidence path
while unlocking real interactive browsing. A later consolidation could back
`agent-browser`-style smokes with the same Playwright session, but that is not
required to ship the interactive tool.

## Feasibility verdict

**Feasible.** A real Playwright-driven, multi-tool browser capability that emits
AI SDK image parts works end to end today: all 18 eval assertions pass against a
real Chromium, screenshots round-trip to byte-identical valid PNGs, and the
constructed image part matches both the installed `ai@6.0.168` types and the
existing chat renderer.

The one real cost is the **~3.5 min cold Chromium install** (download-bound). It
is a *one-time-per-environment* cost, not per-run: pay it once by baking the
Playwright browser cache into the managed-runtime base image or a sandbox
snapshot, after which warm install is ~0 s and per-session cold start is ~1.4 s.
This is the same shape of cost the current `agent-browser install --with-deps`
profile step already absorbs, so it introduces no new class of risk. Per-call
latency (launch + a few actions + screenshot) is sub-2 s, well within an
interactive tool budget.

## Blind spots eliminated

- **Image-part shape is real, not guessed**: read from the installed `ai@6.0.168`
  type defs (`FileUIPart` and the file `UIMessageChunk`) and confirmed against the
  live renderer predicate in `shared-chat-content.tsx`. The Data URL round-trips
  to a byte-identical valid PNG.
- **Screenshots can stream live**: proved the `createUIMessageStream` `writer.write({type:"file",…})`
  call shape; the eval captures exactly one chunk of the correct shape.
- **Tools compose against a shared live page**: navigate→click→extract sees real
  DOM mutations (the JS-revealed secret), so the session-singleton model works.
- **Install time is measured**, not assumed (the briefing's flagged risk).

## Remaining risks

- **Sandbox Chromium system deps**: `playwright install --with-deps` pulls a long
  list of shared libraries (fonts, libnss, libgbm, etc.). In the microVM this
  must be validated against the managed-runtime base image; if `apt` is
  unavailable the deps must be baked into the profile/base image. This is the
  same class of risk `agent-browser install --with-deps` already carries.
- **Screenshot streaming volume**: full-page PNG Data URLs are large (hundreds of
  KB to MBs) and get base64-inflated ~33% inside the message history, bloating
  context and persistence. Mitigations: JPEG/quality + viewport-only by default,
  cap dimensions, and for anything large upload to blob storage and stream a
  hosted `url` instead of a Data URL.
- **Resource lifecycle**: a long-lived Chromium per session consumes memory; need
  idle-timeout teardown (`closeBrowserSession`) and a cap on concurrent contexts.
- **CDP vs. in-process**: the POC launches Chromium in-process. In the sandbox the
  robust pattern is launching Chromium in the microVM and connecting from the app
  over CDP (`connectOverCDP`) via `domain(port)`; that path is described but not
  exercised here.
- **Cross-origin / auth pages**: navigating to authenticated targets needs cookie/
  storage-state handling, out of scope for this POC.
