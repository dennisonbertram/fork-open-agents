<!-- TITLE: feat: interactive headless-browser agent toolset with inline chat screenshots -->

## Why this matters

Today the cloud agent can edit code, run commands, and open PRs, but it is functionally blind to the running result. The only existing browser capability — `apps/web/lib/sandbox/runtime/browser-runs.ts` shelling out to the `agent-browser` CLI — is a coarse, one-shot black box: it takes a single URL, runs a scripted smoke, and persists a `SandboxBrowserRun` row (summary, console/network errors, artifact refs). It answers "did this preview deploy load without errors?" and nothing more. The agent cannot click a button, fill a form, follow a multi-step flow, or interleave "look at the page → reason → act again." Screenshots flow into a DB run record, not into the conversation.

So when a user asks "make the login form validate emails," the agent writes the code, maybe runs a unit test, and says "done" — while the user still has to open a browser, log in, and check by hand. The agent's work ends exactly where the user's verification anxiety begins. This feature gives the agent a real, step-by-step browser it drives itself (`navigate / click / type / extract / screenshot`) with screenshots landing inline in chat as image parts. The bet: an agent that can *see and interact with* the app it just edited closes the trust gap that keeps users babysitting every UI change. It is the most demoable of the three POCs — the user's own app appearing, working, inside the chat — and differentiates open-agents from terminal-only coding agents that can run tests but can't see the rendered result.

## User/operator path protected

The agent chat session on a repo: a user sends a message, the agent streams tool-call cards and assistant text into the chat (`apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`), and the chat workflow (`apps/web/app/workflows/chat.ts`) runs the agent tool loop, persists assistant messages/tool parts, and renders them on reload and on the public share page (`apps/web/app/shared/[shareId]/shared-chat-content.tsx`). Adding browser tools must not regress: existing tool-call rendering, existing file/image part rendering, message persistence and rehydration, the share page, or the unrelated `agent-browser` managed preview-smoke path (`sandboxBrowserRuns`). The settings surface (`Settings → Agent Capabilities`) and per-repo capability persistence must also not regress.

## Behavior contract

- **Given** a session with a reachable dev/preview URL and the browser capability enabled, **when** the agent calls `browser_navigate(url)`, **then** Chromium launches in the session sandbox (cold) or reuses the existing session browser (warm), the page loads, and the tool returns `{ success: true, status, title, url }`.
- **Given** a loaded page, **when** the agent calls `browser_click(selector)` then `browser_extract(selector)`, **then** the second extract observes DOM mutations caused by the click (proving a single live page persists across tool calls within the session).
- **Given** a loaded page, **when** the agent calls `browser_type(selector, value)`, **then** the input's value round-trips back (`inputValue` equals the typed value).
- **Given** the agent calls `browser_screenshot()`, **then** a valid PNG/JPEG is captured, persisted as an AI SDK `FileUIPart` (`{ type:"file", mediaType:"image/...", url }`) appended to the assistant message, **and** streamed live as exactly one file `UIMessageChunk` via the `createUIMessageStream` writer so it renders inline as `<img>` with no renderer change.
- **Given** the browser capability is disabled for the repo, **when** the agent attempts a browser tool, **then** the tool is not registered/available and no Chromium launches.
- **Given** navigation to an unreachable URL, **when** the timeout (30s default) elapses, **then** the tool returns `{ success: false, error: { kind: "navigation_timeout", url } }` and the chat shows a typed, human-readable error — not an unhandled exception.
- **Given** a session with no browser activity for the idle window, **then** the session Chromium is torn down (`closeBrowserSession`) and a subsequent browser call cold-starts cleanly.
- **Given** an oversized full-page capture, **then** the default policy downgrades to a viewport-only screenshot (and/or uploads to blob storage returning a hosted `url`) so the median message-stream image payload stays bounded.

## Product and design spec

A first-class interactive browser toolset the agent composes turn by turn — `browser_navigate`, `browser_click`, `browser_type`, `browser_extract`, `browser_screenshot` — each an ordinary AI-SDK `tool({ description, inputSchema, execute })` (same shape as `read.ts` / `bash.ts`). A live Chromium session persists across calls within a session. Screenshots emit as AI SDK v6 `FileUIPart`s and stream live, rendering inline in the existing chat renderer with zero renderer changes.

### UX — how users use it & how it's exposed

- **No new top-level surface is required to use it** — the agent invokes the tools mid-conversation like any other tool, so browser actions appear as tool-call cards in the chat stream.
- **Settings → Agent Capabilities → "Let the agent open a browser"**: a per-session/per-repo toggle (default on for repos with a detected dev server / preview URL, off otherwise), persisted on the repo capability record.
- **`/preview` slash-command**: an explicit nudge ("open the running app and show me") for users who want to invoke it rather than wait for the agent to decide.
- The **inline screenshots themselves are the primary surface**: the entry point for the user is simply seeing the app appear in their chat. Walkthrough: user asks "add inline email validation and make sure it works" → agent edits + runs unit test → `browser_navigate` to `/signup` (chip "Starting browser…" then "Navigated (200)") → `browser_screenshot` renders the form inline → `browser_type` `not-an-email` into `#email`, `browser_click` "Sign up" → `browser_extract` shows "Please enter a valid email address" → second `browser_screenshot` shows the red error → agent summarizes with the screenshots above. The user never opened a browser.

### UX — how the feature demonstrates & explains its value to the user

- The **inline screenshot is the proof**: a bordered image block captioned with the URL and viewport size (e.g. `localhost:3000/login · 1280×720`) with an "open full size" affordance. Seeing their actual app render inside chat is the instantly legible "it worked" moment.
- **Extract results are rendered as a small quoted block** ("Extracted from `#heading`: *Headless Browser POC*") so the agent's "what it saw" is legible to the user, not buried in tool JSON — making the agent's reasoning auditable.
- **First-run hint / empty state**: if no preview URL/dev server is detected, the toggle and any browser tool-call show "No running app detected — start your dev server or set a preview URL to let the agent see your app," teaching the prerequisite in context.
- **Cold-start hint**: the first browser action in a cold session shows "Starting browser… (~1.4s)" reflecting the measured cold-start, so the brief pause is explained rather than mysterious.

### UX — how it's clear what the feature is doing (states & feedback)

- **Idle/disabled**: no browser cards; if no preview URL, the "No running app detected" empty state.
- **Tool-call card (in stream)**: a compact card per action — `Navigating to localhost:3000/login`, `Clicking "Sign in"`, `Typing into #email` — each with a status chip (running / done / failed) and the URL or selector it acted on. Collapsed by default, expandable to raw args/result.
- **Loading (cold)**: "Starting browser… (~1.4s)" chip on the first action.
- **Screenshot streaming**: a low-res/skeleton placeholder until the single file chunk arrives, then the inline image.
- **Success**: status chip flips to done; the captioned image or quoted extract renders.
- **Error states (typed, user-facing copy)**: navigation timeout → "Couldn't reach `<url>` (timed out after 30s)"; auth wall → "Page required sign-in; the agent can't authenticate here yet"; oversized screenshot → silently downgraded to viewport-only with a note. Every state maps to a `success:false` result with a typed `error.kind` so the chip and copy are deterministic.

### UX — how to test the UX, including regressions

Following the repo's authenticated-local-UI-smoke discipline: run the local web app DB-backed (`bun run --cwd apps/web db:migrate:apply`, `bun run web`), sign in, open a session on a repo with a running fixture dev server, and drive the path with Agent Browser. **Happy-path smoke**: enable the capability in Settings, send "open the app and screenshot the homepage," and assert (a) a `browser_navigate` card appears with a done chip and 200 status, (b) a `browser_screenshot` card renders an inline `<img>` captioned with URL + viewport, (c) `agent-browser errors` and `agent-browser console` are clean, (d) the screenshot survives a page reload (persisted part rehydrates) and renders on the share page. **UX regression locks**: a renderer-level test that a `WebAgentUIMessage` containing a browser `FileUIPart` renders an `<img>` with the expected `src` and caption (fails before: the new captioned-image part isn't rendered; passes after); a test that the capability toggle off removes browser tool cards entirely; a test that existing non-browser tool cards and file parts still render unchanged (guards against renderer regressions). A UX regression would assert "an image-type file part always renders inline and never as raw JSON" and "the capability toggle gates tool availability."

## Integration spec

- **Tool module**: add `packages/agent/tools/browser.ts` from the POC's `browser-tool.ts`, replacing the POC `BrowserToolContext` resolution with a per-session browser resolver keyed off `experimental_context` mirroring `packages/agent/tools/utils.ts#getSandbox`. Launch flags inside the microVM need `--no-sandbox`.
- **Registration**: export the five factories from `packages/agent/tools/index.ts` (alongside `readFileTool`, `bashTool`, …) and add them to the agent tool set; gate via the approval policy (see Out of scope / POC 1b dependency), mirroring `bash.ts`'s `needsApproval`.
- **Image-part path**: the renderers already handle `part.type === "file" && part.mediaType?.startsWith("image/")` in `apps/web/app/shared/[shareId]/shared-chat-content.tsx` and `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`. Pass the `createUIMessageStream` writer (used in `apps/web/app/workflows/chat.ts`) through `experimental_context` and call `writer.write(buildScreenshotStreamChunk(...))`; append the persisted `FileUIPart` from `buildScreenshotPart(...)` to the assistant `WebAgentUIMessage.parts` (type in `apps/web/app/types.ts`). The exact part/chunk shapes come from the POC's `image-part.ts`.
- **Sandbox execution**: use `packages/sandbox/interface.ts` (`exec` to install browser deps, `domain(port)` to expose a remote-debugging endpoint for `chromium.connectOverCDP(...)`). The managed-runtime profile that today runs `agent-browser install --with-deps` (`packages/sandbox/profiles/web-bun-agent-browser/setup.sh`) instead runs `playwright install --with-deps chromium`; bake the Playwright browser cache into the base image so cold install is paid once.
- **Lifecycle**: add `closeBrowserSession` with an idle-timeout teardown and a concurrent-context cap.
- **Screenshot policy**: viewport-only JPEG defaults + dimension caps; for large/full-page captures upload to blob storage and stream a hosted `url` instead of a Data URL.
- **Settings/capability**: add a per-repo "open a browser" capability flag to the repo capability/settings record and a Settings → Agent Capabilities toggle; add a `/preview` slash-command.
- No new DB table is strictly required for the tool itself (screenshots ride existing message parts); a capability flag column may be added to the existing repo settings table.

## In scope

- Five interactive browser tools (`browser_navigate`, `browser_click`, `browser_type`, `browser_extract`, `browser_screenshot`) as AI-SDK tools registered in the agent tool set.
- Per-session live Chromium with a per-session resolver mirroring `getSandbox`, plus idle-timeout teardown and a concurrency cap.
- Live-streamed and persisted screenshot image parts rendering inline (no renderer changes).
- Viewport-only screenshot default with dimension caps and blob upload for large captures.
- Per-repo capability toggle in Settings + `/preview` slash-command.
- Typed error kinds (navigation_timeout, auth_required, oversized) surfaced as `success:false` results.
- Sandbox profile change to install Playwright Chromium (base-image bake).

## Out of scope

- **Approval gating of arbitrary navigation / destructive interactions** — depends on POC 1b (approval gate); this issue assumes 1b's policy is available and registers browser tools behind it, but does not build the gate.
- **Authenticated-page support** (cookie/storage-state handling) — explicit fast-follow, deferred.
- **`connectOverCDP` robustness hardening** beyond the documented sandbox path — initial build may launch in-process; CDP-over-`domain(port)` proof is a follow-up.
- **Consolidating `agent-browser` smokes onto the same Playwright session** — layer, don't replace; deferred.
- Visual-diff/regression-image comparison tooling.

## Research and context sources

- POC PR **#80** (branch `poc/1a-browser-tool`) and folder `POC/1a-browser-tool/`.
- Eval evidence: `POC/1a-browser-tool/evidence/eval-log.txt` (all 18 assertions pass, exit 0), `evidence/screenshot.png` (byte-identical PNG round-trip), `evidence/image-part.json` (constructed `FileUIPart`).
- Product brief: `POC/1a-browser-tool/PRODUCT-BRIEF.md` (TL;DR, gap, case FOR/AGAINST, greenlight trigger).
- README integration plan: `POC/1a-browser-tool/README.md`.
- External research findings (from README): AI SDK `ai@6.0.168` `FileUIPart` and file `UIMessageChunk` shapes read from installed type defs (not guessed); renderer predicate confirmed in `shared-chat-content.tsx`; measured timings (Chromium cold install ~211s/one-time, warm ~0s, cold start ~1410ms, full eval <1s, 27,773-byte PNG); `playwright install --with-deps` shared-lib dependency list flagged against the managed base image.

## Agent todo checklist

- [ ] Write failing renderer test: a browser `FileUIPart` renders an inline captioned `<img>`.
- [ ] Write failing tool tests: navigate→click→extract observes DOM mutation; type round-trips; screenshot emits exactly one file chunk + persisted part; disabled capability → no tool.
- [ ] Confirm red; commit the red tests.
- [ ] Add `packages/agent/tools/browser.ts` with the per-session resolver (mirror `getSandbox`).
- [ ] Wire the `createUIMessageStream` writer through `experimental_context` in `chat.ts`; append persisted parts.
- [ ] Register tools in `packages/agent/tools/index.ts` behind the approval policy hook.
- [ ] Add idle-timeout `closeBrowserSession` + concurrency cap.
- [ ] Add screenshot sizing policy (viewport-only JPEG default, caps, blob upload path).
- [ ] Update the sandbox profile to `playwright install --with-deps chromium` and bake the cache into the base image.
- [ ] Add Settings → Agent Capabilities toggle + per-repo capability flag + `/preview` slash-command.
- [ ] Add structured observability events + typed error kinds (see Observability).
- [ ] Run targeted tests green; commit green.
- [ ] Authenticated local UI smoke with Agent Browser; capture screenshot evidence.
- [ ] `git diff --check`; `bun --bun run ci`.

## Tests to add first

- **UX/renderer (behavior)**: rendering a `WebAgentUIMessage` whose parts include a browser screenshot `FileUIPart` produces an inline `<img>` with the expected `src` (Data URL or hosted) and a caption containing the URL + viewport — fails before the part is handled, passes after.
- **Tool composition**: against a local fixture page, `browser_click` then `browser_extract` returns the JS-revealed value (asserts a single live page persists across calls).
- **Type round-trip**: `browser_type(selector,value)` then `inputValue(selector)` equals `value`.
- **Screenshot stream/persist**: `browser_screenshot` emits exactly one `{type:"file",url,mediaType}` chunk via the writer AND appends a persisted `FileUIPart`; the Data URL decodes to a valid PNG whose byte length matches the reported length.
- **Capability gate**: with the browser capability disabled, browser tools are absent from the registered tool set and no Chromium launches.
- **Error mapping**: navigation to an unreachable URL yields `{ success:false, error:{ kind:"navigation_timeout" } }`, not a throw.

## Observability and user feedback

- **User-visible status**: per-action tool-call status chips (running / done / failed) with the URL/selector; cold-start chip; typed error copy; inline screenshot or quoted extract.
- **Named service + structured events**: a `browser` service emits, alongside the existing chat events, `browser.session.started` (info; fields `sessionId`, `sandboxName`, `coldStartMs`), `browser.action.performed` (info; fields `sessionId`, `chatId`, `action` ∈ navigate|click|type|extract|screenshot, `selectorOrUrl`, `durationMs`, `success`), `browser.screenshot.captured` (info; fields `sessionId`, `chatId`, `byteLength`, `mediaType`, `mode` ∈ viewport|fullpage|blob, `streamed:true`), `browser.session.closed` (info; fields `sessionId`, `reason` ∈ idle|abort|cap), and `browser.action.failed` (warn/error; fields `sessionId`, `error.kind`).
- **Typed error kinds**: `navigation_timeout`, `auth_required`, `selector_not_found`, `oversized_capture_downgraded`, `browser_launch_failed`, `concurrency_cap_reached`.
- **Correlation IDs**: `userId`, `sessionId`, `chatId`, `requestId`, `sandboxName` on every event.
- **Redaction rules**: never log screenshot bytes or full Data URLs (log `byteLength` + `mediaType` only); redact query strings / tokens in logged URLs; never log page-extracted secret text.
- **Grep-able debug recipes**: `grep 'browser.action.failed' | grep '"kind":"navigation_timeout"'` to find unreachable previews; `grep 'browser.screenshot.captured' | grep '"mode":"fullpage"'` to find oversized captures bypassing the policy; filter by `sessionId` to reconstruct a session's browser timeline.
- **Evidence expectation**: the authenticated local UI smoke must capture an inline-screenshot screenshot plus the corresponding `browser.*` event log lines.

## Regression harness plan

- **New coverage**: (1) a renderer unit test for inline browser image parts; (2) a tool integration test (POC `eval.ts` ported) driving navigate→click→type→extract→screenshot against a served local fixture (`POC/1a-browser-tool/fixtures/index.html`) asserting real outcomes + the single-file-chunk shape; (3) a capability-gate test. **Fixtures/setup**: the static fixture page served over HTTP; a headless Chromium with the Playwright cache present (CI installs once / uses the baked cache). **Fail-before/pass-after**: before implementation the renderer test fails (no inline image for the new part) and the tool tests fail (tools unregistered); after, all pass. **Limits — what it will NOT catch**: in-microVM `playwright install --with-deps` system-dependency gaps, real CDP-over-`domain(port)` behavior, authenticated-page flows, fleet-wide memory pressure from long-lived Chromium, and screenshot context-bloat cost regressions in production — these need a managed-runtime sandbox validation outside the unit harness.

## TDD audit trail

- **Red commit**: add the renderer test + tool tests. Command: `bun test packages/agent/tools/browser.test.ts apps/web/.../session-chat-content.test.tsx`. Expected failing output: `error: cannot find module ".../browser"` / renderer assertion `expected <img> … received` — assertions fail because the tools and inline-image handling don't exist. Commit the red tests.
- **Green commit**: implement `browser.ts`, the writer wiring, registration, and renderer handling; rerun the same command; expected output `pass` for all browser/renderer assertions. Commit green.
- **Exception**: none expected; red and green are separable.

## Regression risks and concerns

- **Resource lifecycle**: a long-lived Chromium per session consumes memory; without disciplined idle-timeout teardown and a concurrency cap, fleet-wide microVM memory pressure and orphaned browser processes grow with adoption (PRODUCT-BRIEF case AGAINST #1).
- **Screenshot volume bloats context/persistence**: full-page PNG Data URLs are hundreds of KB to MBs, base64-inflated ~33% in message history — ballooning token cost, DB size, and per-turn latency if defaults are wrong (case AGAINST #2). Mitigate with viewport-only JPEG defaults + blob upload.
- **Sandbox system-deps + CDP unexercised**: `playwright install --with-deps` pulls a long shared-library list; the in-microVM path and `connectOverCDP` over `domain(port)` are described but not proven in the sandbox (README remaining risks; case AGAINST #4).
- **Authenticated pages out of scope**: the agent stalls where most app logic lives until storage-state is added.
- **Renderer/persistence regression**: incorrect part shapes could break existing file/image rendering or the share page.

## Deploy or migration impact

- **Migrations**: optional `add` of a per-repo browser-capability flag to the existing repo settings table — generate via `bun run --cwd apps/web db:generate` and commit the `.sql`.
- **Env/flags**: a feature flag to dark-launch browser tools per repo; blob-storage credentials for hosted screenshot URLs.
- **Managed-runtime/sandbox**: profile change to install Playwright Chromium and bake the cache into the base image (one-time ~3.5 min cost absorbed in image build, mirroring the current `agent-browser install --with-deps` step); `--no-sandbox` launch flag in-microVM.
- **Rollout/rollback**: ship dark, enable per-repo behind the flag; rollback by disabling the flag (tools simply unregister). **Cost**: added per-session Chromium memory + blob storage for screenshots; greenlight trigger is median message-stream image payload under ~50KB.

## Definition of done

- [ ] Red test observed first (renderer + tool tests failing).
- [ ] Behavior proof red before implementation captured.
- [ ] Red-test commit (or documented exception) recorded.
- [ ] Green commit after red.
- [ ] Targeted tests pass (`bun test` browser tool + renderer).
- [ ] Adjacent suite passes (agent tools + chat workflow + renderer suites).
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (renderer test + ported tool eval + capability gate).
- [ ] Docs updated (capability toggle, screenshot policy, sandbox profile note; lessons-learned if applicable).
- [ ] Observability evidence captured (inline-screenshot smoke + `browser.*` log lines).
- [ ] Deploy notes included (migration, flag, base-image bake, rollback).
