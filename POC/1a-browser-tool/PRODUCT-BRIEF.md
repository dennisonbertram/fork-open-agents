# Product Brief: Headless-Browser Agent Tool

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
Give the cloud agent a real, step-by-step browser it drives itself — `navigate / click / type / extract / screenshot` — with screenshots landing inline in the chat as image parts. It serves the developer who just had the agent change UI code and wants proof it actually renders and works, not just that it compiled. The core bet: an agent that can *see and interact with* the app it just edited closes the trust gap that keeps users babysitting every change. Recommendation: build it, gated behind the approval gate (POC 1b), as the marquee "the agent verifies its own work" capability.

## The gap today
Today the agent can edit code, run commands, and open PRs, but it is functionally blind to the running result. The one existing browser capability — `apps/web/lib/sandbox/runtime/browser-runs.ts` shelling out to the `agent-browser` CLI — is a coarse, one-shot black box: it takes a single URL, runs a scripted smoke, and persists a `SandboxBrowserRun` row (summary, console/network errors, artifact refs). It answers "did this preview deploy load without errors?" and nothing more. The agent cannot click a button, fill a form, follow a multi-step flow, or interleave "look at the page → reason → act again." Screenshots flow into a DB run record, not into the conversation. So when a user asks "make the login form validate emails," the agent writes the code, maybe runs a unit test, and then says "done" — while the user still has to open a browser, log in, and check by hand. The agent's work ends exactly where the user's verification anxiety begins.

## What we'd build
A first-class interactive browser toolset the agent composes turn by turn: `browser_navigate`, `browser_click`, `browser_type`, `browser_extract`, `browser_screenshot`. Each is an ordinary AI-SDK tool (same `tool({ description, inputSchema, execute })` shape as `read.ts` / `bash.ts`), so the model decides when and how to use them as part of its reasoning. A live Chromium session persists across calls within a session, so navigate→click→extract sees real DOM mutations — the POC proved this by clicking a JS reveal link and then extracting the freshly-injected secret. Screenshots are emitted as AI SDK v6 `FileUIPart`s (`{ type:"file", mediaType:"image/png", url }`) and stream live via the `createUIMessageStream` writer, so they render inline as `<img>` in the existing chat renderer (`shared-chat-content.tsx` / `session-chat-content.tsx`) with zero renderer changes. The POC validated all 18 assertions against a real Chromium, including byte-identical PNG round-trips and the exact streamed-chunk shape.

## How users experience it
### Where it lives (exposure)
No new top-level surface is required to *use* it — the agent invokes the tools mid-conversation like any other tool, so browser actions appear as tool-call cards in the chat stream. What users control:
- A per-session/per-repo toggle in **Settings → Agent Capabilities → "Let the agent open a browser"** (default on for repos with a detected dev server / preview URL, off otherwise).
- A slash-command nudge, `/preview`, that tells the agent "open the running app and show me," for users who want to invoke it explicitly rather than wait for the agent to decide.
- The screenshots themselves are the primary surface: they render inline, so the "entry point" for the user is simply seeing the app appear in their chat.

### Sample UI
- **Tool-call card (in stream):** a compact card per browser action — `Navigating to localhost:3000/login`, `Clicking "Sign in"`, `Typing into #email` — each with a status chip (running / done / failed) and the URL or selector it acted on. Collapsed by default; expandable to show the raw args/result.
- **Inline screenshot:** a bordered image block captioned with the URL and viewport size (e.g. `localhost:3000/login · 1280×720`), with a "open full size" affordance. While streaming, a low-res/skeleton placeholder shows until the file chunk arrives (the POC proved exactly one file chunk streams per screenshot).
- **Extract result:** rendered as a small quoted text block ("Extracted from `#heading`: *Headless Browser POC*") so the agent's "what it saw" is legible to the user, not buried in tool JSON.
- **Empty state:** if no preview URL/dev server is detected, the browser toggle shows "No running app detected — start your dev server or set a preview URL to let the agent see your app."
- **Loading state:** first browser action in a cold session shows "Starting browser… (~1.4s)" reflecting the measured cold-start.
- **Error states:** navigation timeout → "Couldn't reach `<url>` (timed out after 30s)"; auth wall → "Page required sign-in; the agent can't authenticate here yet"; oversized screenshot → silently downgraded to viewport-only JPEG with a note.

### UX walkthrough
1. User: "Add inline email validation to the signup form and make sure it works."
2. Agent edits the form component and the validation util, runs the unit test (green).
3. Agent calls `browser_navigate` to the repo's dev/preview URL `/signup`. A "Starting browser…" chip flashes, then "Navigated to /signup (200)".
4. Agent calls `browser_screenshot`; the signup form renders inline in chat captioned `…/signup · 1280×720`. The user can see the form as the agent sees it.
5. Agent calls `browser_type` into `#email` with `not-an-email`, then `browser_click` on "Sign up".
6. Agent calls `browser_extract` on the error region; the card shows "Extracted: *Please enter a valid email address*".
7. Agent calls `browser_screenshot` again — the inline image now shows the red validation error under the field.
8. Agent summarizes: "Validation works — invalid emails are blocked with an inline error (screenshot above). Here's the PR." The user never opened a browser.

## Value to the user
**Job-to-be-done:** "When the agent changes my UI, I want to *see and trust* that it actually works before I review the PR, without leaving the chat." Scenarios:
- **Visual bug report → fix → proof:** "The dropdown overlaps the header on mobile." The agent fixes the CSS, sets a mobile viewport, screenshots the corrected layout inline. The user confirms from the image instead of pulling the branch.
- **Multi-step flow verification:** "Make the checkout require a coupon." The agent walks add-to-cart → checkout → apply coupon, extracting the total at each step, and shows screenshots of the gated state. This is impossible with the one-shot smoke today.
- **"Does my deploy even render?":** After a dependency bump, the agent navigates the preview URL and screenshots the home page, catching a blank-screen hydration error the unit tests missed.

## Value to the product
This is the most *demoable* capability of the three: a screenshot of the user's actual app appearing inside the chat is an instantly legible "wow." It differentiates open-agents from terminal-only coding agents (Codex CLI, Claude Code, Cursor's agent) that can run tests but can't *see* the rendered result. It directly drives activation (first-session "it showed me my app working" moment) and retention (users stop context-switching to a browser, so more of their loop stays in-product). Strategically it positions open-agents as "the agent that verifies its own front-end work," which is the single hardest thing for users to trust an autonomous agent to do — and the per-session microVM sandbox is the natural, safe home for a real browser, which most competitors lack.

## The case FOR (strong)
1. **It closes the trust gap on UI work, which is where autonomous agents are least trusted.** Code that compiles can still render broken; the agent seeing the result is qualitatively different from running a test. This is the feature that makes "let the agent just do it" feel safe for front-end changes.
2. **Proven feasible end to end, today.** All 18 eval assertions pass against real Chromium: byte-identical PNG round-trip, exact image-part shape matching `ai@6.0.168` types, live stream chunk, real DOM-mutation composition. The renderer already handles image parts — zero renderer work. The integration is well-scoped (drop in as `packages/agent/tools/browser.ts`, resolve a per-session browser like `getSandbox`).
3. **The hard cost is one-time and already absorbed elsewhere.** The flagged ~3.5 min Chromium install is download-bound and per-environment, not per-run; bake it into the managed-runtime base image (the current `agent-browser install --with-deps` profile step already absorbs this exact class of cost). Per-session cold start is ~1.4s, per action sub-2s — well within an interactive budget.
4. **It's the best demo and activation surface of the three POCs.** Nothing communicates "this agent is different" faster than the user's own app appearing, working, inside the chat.
5. **It layers cleanly without regressing existing evidence paths.** Keep `agent-browser` for managed preview smokes (it satisfies the repo's observability/redaction discipline); add this as the interactive layer. They share no state, so shipping it risks nothing already verified.

## The case AGAINST (strong)
1. **A long-lived Chromium per session is a real resource and lifecycle liability.** Each session holds memory; without disciplined idle-timeout teardown and a concurrency cap, fleet-wide microVM memory pressure and orphaned browser processes become an operational tax that grows with adoption.
2. **Screenshot volume bloats context and persistence, silently degrading the core product.** Full-page PNG Data URLs are hundreds of KB to MBs, base64-inflated ~33% inside message history. An agent that screenshots liberally will balloon token cost and DB size and slow every subsequent turn. Mitigations exist (JPEG, viewport-only, blob upload + hosted URL) but they're required work, not free, and getting the defaults wrong makes the headline feature a cost regression.
3. **Authenticated pages — i.e. most real apps past the login screen — are out of scope.** The POC explicitly punts cookie/storage-state handling. Without it, the agent can verify public/unauthed routes but stalls exactly where most app logic lives, which undercuts the "verify the real flow" promise until auth handling is built.
4. **Sandbox system-deps risk and CDP plumbing are unexercised.** `playwright install --with-deps` pulls a long shared-library list; the in-microVM path (and the robust `connectOverCDP` over `domain(port)` pattern) is described but not proven in the sandbox. There's integration risk between "works on Apple Silicon dev machine" and "works in the managed microVM."
5. **Partial redundancy + a simpler alternative exists.** For "did the deploy render," the existing `agent-browser` smoke already answers it. One could ship a thinner "agent can request a screenshot of URL X" tool without the full interactive toolset and capture 60% of the demo value at a fraction of the lifecycle/cost risk. The full interactive composition is only justified if multi-step verified flows are a real, common need.

## Effort, dependencies & risk
- **Feasibility verdict (from POC):** Feasible — proven end to end with 18 passing real-Chromium assertions; image-part shapes read from installed types, not guessed; live streaming validated.
- **Build size:** Medium. Tool module + per-session browser resolver (mirror `getSandbox`) + base-image bake of the Playwright cache + screenshot sizing/upload policy + lifecycle teardown. Renderer needs no change.
- **Cross-POC dependencies:** Should ship gated by **POC 1b (approval gate)** for navigation-to-arbitrary-URL and any destructive interaction (mirror `bash.ts`'s `needsApproval`). Benefits from blob storage for hosted screenshot URLs.
- **Top risks & mitigations:** (a) Resource lifecycle → idle-timeout `closeBrowserSession` + concurrency cap, ship from day one. (b) Screenshot bloat → viewport-only JPEG defaults, dimension caps, blob upload for large/full-page. (c) Sandbox deps/CDP → validate `playwright install --with-deps` against the managed base image and prove the `connectOverCDP` path before GA. (d) Auth pages → fast-follow storage-state support.

## The decision
**The question to answer:** Is "the agent visually verifies the UI it just changed" a capability worth a medium build plus an ongoing resource/cost-control tax — or is a thin screenshot-of-URL tool enough? **Greenlight trigger:** sandbox validation confirms `playwright install --with-deps` + `connectOverCDP` work in the managed microVM, and a screenshot-sizing policy keeps median message-stream image payload under ~50KB. **Success looks like:** measurable drop in "I had to check it myself" round-trips (sessions where the user re-opens a browser after the agent says done), browser tool used in a meaningful share of UI-change sessions, and inline screenshots correlated with higher PR-merge-without-edit rates. **Suggested default: build now**, scoped to viewport-only screenshots by default, gated behind 1b, with auth-page support as an explicit fast-follow. It's the highest-differentiation, best-demo capability of the three and the feasibility risk is well-understood and bounded.
