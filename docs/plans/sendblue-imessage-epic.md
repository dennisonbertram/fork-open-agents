# Epic: Talk With Agents Over iMessage (Sendblue)

Prepared: 2026-06-09

Status: Deferred — not currently planned (deferred 2026-06-09)

GitHub issue: https://github.com/dennisonbertram/fork-open-agents/issues/262 (closed: not planned)

---

> **Deferral note (2026-06-09):** Parked as hard / uncertain value. Sendblue's AI Agent plan is
> inbound-initiated only ($100/mo; cold outbound needs Enterprise), and the inbound webhook
> signature scheme is undocumented — a hard blocker that cannot be verified without a live
> account. The design below is preserved for reference; reopen issue #262 (and slices
> #265–#268) to revive it.

---

## Executive Summary

Add an iMessage channel (via Sendblue) so users can converse with their Open
Agents by text. The architecture models Sendblue exactly like the Composio
provider integration: a settings card on a new "Channels" surface that links and
verifies a phone number, picks which session and agent answers, and shows
connection health via `ReadinessVerdict`. Inbound iMessages hit an account-level
webhook (`POST /api/channels/sendblue/webhook`), are secret-verified and deduped
on `message_handle`, persisted as untrusted (redacted) bodies, then routed to
the existing chat workflow (`runAgentWorkflow`) for conversational replies. When
an inbound message would take repo or tool actions, it is dispatched through the
existing background-agents run and approval gate rather than bypassing it.
Outbound replies return via `POST /api/send-message` using a sticky `from_number`
mapping.

The feature reuses the shared observability primitive (`sessionEvents` /
`recordSessionEvent` with `redactionStatus`) and the existing correlation-ID set.
It does not introduce a parallel observability or redaction stack.

Sequenced minimal-first:

1. Inert link + verify + `ReadinessVerdict` settings card (no inbound).
2. Inbound webhook to verified, deduped transcript (shadow, no replies).
3. Conversational reply loop through the chat workflow.
4. Repo/tool actions routed through the background-agents approval gate.

The four implementation slices exist as GitHub issues #265, #266, #267, and #268.

## Why This Matters

iMessage is where users already live. Letting them text an agent and get work
back removes the "open the laptop, open the web app" tax and makes Open Agents
feel ambient and personal. It also proves the platform's channel abstraction
generalizes beyond the web client — the same `runAgentWorkflow` entry point that
serves the browser can serve any external channel, validating the "one product,
many surfaces" thesis.

Strategically it composes three live epics — chat/session, background-agents
approval gate, and shared observability — into a single user-visible loop,
demonstrating they form one coherent system rather than five bolt-ons. It also
provides the first field test of the `ReadinessVerdict` grammar and the
`SettingsSection`/`SettingsPageHeader` component system in a channel context
outside Composio, proving those primitives generalize.

## User/Operator Path Protected

**User:** A user with a verified iMessage number texts their linked agent and
gets an answer back over iMessage within seconds for conversational turns. For
any message that would mutate a repo or call external tools, the run is gated
behind the existing background-agents approval flow. The agent never silently
pushes code from an untrusted inbound text.

**Operator:** An operator opens Settings → Channels, sees the Sendblue connection
`ReadinessVerdict` (ready / action-needed / unavailable / error), the verified
number's last-4 plus status chip, the bound session/agent, and a transcript with
delivery states and correlation IDs for every inbound and outbound message.

**Behavior contract:**

- Given a verified channel in `conversational` mode, when the user texts a
  question, the inbound is verified, deduped, persisted (redacted), routed to
  `runAgentWorkflow`, and the agent's reply is delivered back over iMessage from
  the sticky `from_number`, with both messages in the transcript with delivery
  ticks.
- Given a duplicate webhook delivery (same `message_handle`), when Sendblue
  retries (up to 4x), the `onConflictDoNothing` insert no-ops and only the first
  delivery triggers routing — no duplicate replies.
- Given a channel in `background_gated` mode, when an inbound message would
  mutate a repo or call a tool, the run is dispatched through the
  background-agents dispatcher and pauses at `requireApproval`
  (`awaiting_approval`); the awaiting-approval state and resulting run URL are
  surfaced back over iMessage.
- Given an unconfigured `SENDBLUE_WEBHOOK_SECRET` in production, when a webhook
  arrives, verification fails closed (500, no routing).
- Given a redaction failure on an inbound body, the body is tagged `blocked` and
  excluded from any logged event payload.

## Key Research Findings

**Authentication is two custom headers, not OAuth.** Sendblue auth is
`sb-api-key-id` and `sb-api-secret-key` sent as headers on every request — no
OAuth, no scopes. This is a stored-secret integration (key names and status
surfaced in `ReadinessVerdict`, never values), matching the Composio
bring-your-own-auth philosophy. There is no OAuth callback flow to wire up.

**Account-level webhook shared across all lines.** Sendblue provides one receive
webhook per account, not per phone number. All inbound messages from all lines
arrive at the same endpoint. The payload carries `to_number` and `sendblue_number`
to identify which line was addressed; the webhook handler must disambiguate via
`to_number`.

**`message_handle` is the idempotency key; Sendblue retries up to 4x.** On 5xx
or a 45-second timeout, Sendblue redelivers the same event up to three additional
times (1 + 3 retries). Mirror the GitHub-webhook idempotency pattern:
`insert().onConflictDoNothing({ target: messageHandle })` and respond 200 fast
via `after()`. The unique index on `messageHandle` ensures only the first
delivery triggers routing.

**Webhook signature scheme is undocumented — hard blocker for inbound.** The
header name and HMAC-vs-plaintext scheme for webhook signatures are not
documented in the Sendblue API reference and must be confirmed against a live
webhook. Slices #266, #267, and #268 are gated on this confirmation. Slice #265
ships inert (OTP entered in the web UI) and requires no webhook at all, so it
can proceed in parallel.

**Sticky `from_number` — one pool line per contact.** Once a Sendblue pool
number texts a contact, all subsequent messages to that contact must come from
the same pool number. Violating this breaks the iMessage thread. `fromNumber`
must be persisted on the channel at first send and read before every outbound.

**AI Agent plan is inbound-initiated only.** The Sendblue AI Agent plan ($100/mo)
requires the customer to text first. Cold outbound (agent texts the user first)
requires the Enterprise plan. v1 is strictly inbound-initiated conversations
plus verification sends and manual test sends to already-known numbers.

**Rate limits: 1 msg/sec, 2,000/hr, 4,000/day, reset at 3 am EST.** The
per-line rate limits are enforced by Sendblue. Open Agents must track per-line
counts, emit a `channel.sendblue.rate_limited` event on breach, and surface
`action-needed` in `ReadinessVerdict`. Do not rely on Sendblue's queue for
back-pressure.

**Inbound bodies are a prompt-injection surface.** Attacker-controlled message
bodies must be redacted via `redactHarnessPayload` and tagged `redactionStatus`
before being persisted or emitted in event payloads. Redaction failures block
the body from all logs and events.

**`ReadinessVerdict` is the canonical health grammar.** Every status and health
surface in this feature must use the `ready` / `action-needed` / `unavailable` /
`error` states from `components/ui/readiness-verdict.tsx`, built from
`SettingsSection` / `SettingsPageHeader`. No bespoke cards.

## System Design

### Source Of Truth

**Provider-owned (Sendblue):** the iMessage/SMS transport, line health, message
delivery state transitions (`REGISTERED → SENT → DELIVERED → ERROR`), the
canonical `message_handle` UUID, CDN-hosted media URLs (expire 30 days), the
sticky-sender protocol constraint, contact registration on free and AI Agent
plans, and all rate limiting. Open Agents must never treat its DB as the source
of truth for delivery state — it mirrors provider status via the outbound
`status_callback` / webhook.

**Open-Agents-owned:** which `userId` owns a channel link, the verified number ↔
userId ↔ session/agent binding, the contact → `fromNumber` sticky mapping, the
local transcript mirror, idempotency dedup on `messageHandle`, the routing
decision (conversational chat vs. gated tool actions), the OTP lifecycle,
per-body redaction status, and the correlation IDs tying a message to a
`workflowRunId` or `backgroundAgentRunId`. The Sendblue API key and secret are
stored secrets owned operationally by the deployment environment — surface names
and presence only, never values.

### Data Model

Three new tables in `apps/web/lib/db/schema.ts`. After editing schema, run
`bun run --cwd apps/web db:generate` and commit the generated `.sql`. Reuse
`sessionEvents` for all observability — no parallel events table.

```ts
// 1) Channel link: one verified phone number bound to a session/agent.
export const sendblueChannels = pgTable("sendblue_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),       // E.164, the number we converse WITH
  fromNumber: text("from_number"),                   // E.164 Sendblue line (sticky); null until first send
  verificationStatus: text("verification_status", {
    enum: ["unverified", "pending", "verified", "failed"],
  }).notNull().default("unverified"),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  agentMode: text("agent_mode", { enum: ["conversational", "background_gated"] })
    .notNull().default("conversational"),
  status: text("status", { enum: ["enabled", "disabled"] }).notNull().default("enabled"),
  guardrails: jsonb("guardrails")
    .$type<SendblueGuardrails>()
    .notNull()
    .default({ requireApprovalForTools: true, allowRepoActions: false }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("sendblue_channels_user_phone").on(t.userId, t.phoneNumber),
  index("sendblue_channels_phone").on(t.phoneNumber),
]);

export type SendblueGuardrails = {
  requireApprovalForTools: boolean; // default true
  allowRepoActions: boolean;        // default false — must be explicitly enabled
};

// 2) Verification OTP lifecycle.
export const sendblueVerifications = pgTable("sendblue_verifications", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => sendblueChannels.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(), // hash of OTP, never plaintext
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("sendblue_verifications_channel").on(t.channelId)]);

// 3) Transcript mirror + idempotency. messageHandle is the dedup key.
export const sendblueMessages = pgTable("sendblue_messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => sendblueChannels.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageHandle: text("message_handle").notNull(), // Sendblue UUID — UNIQUE for idempotency
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  service: text("service", { enum: ["iMessage", "SMS"] }),
  body: text("body"),                              // persisted; untrusted; redacted in event payloads
  redactionStatus: text("redaction_status", {
    enum: ["not_required", "passed", "failed", "blocked"],
  }).notNull().default("passed"),
  deliveryStatus: text("delivery_status", {
    enum: ["received", "queued", "accepted", "sent", "delivered", "error"],
  }),
  errorKind: text("error_kind"),
  sessionId: text("session_id"),
  chatId: text("chat_id"),
  workflowRunId: text("workflow_run_id"),
  backgroundAgentRunId: text("background_agent_run_id"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("sendblue_messages_handle").on(t.messageHandle),
  index("sendblue_messages_channel_created").on(t.channelId, t.createdAt),
]);

export type SendblueChannel = typeof sendblueChannels.$inferSelect;
export type SendblueMessage = typeof sendblueMessages.$inferSelect;
```

The `guardrails` JSONB column has an explicit default to avoid NULLs. Migrations
apply automatically on every Vercel build; preview deployments use isolated Neon
branches.

### Integration Points

**New lib concern `apps/web/lib/channels/sendblue/*`** — mirrors
`lib/composio/*` and `lib/background-agents/*`:

- `client.ts` — backend-only `sendMessage` / `evaluateService` with
  `sb-api-key-id` + `sb-api-secret-key` headers. Sendblue blocks frontend
  origins; this file must never be imported by client components.
- `config.ts` — `getSendblueApiKeyId` / `getSendblueApiSecretKey` /
  `getSendblueWebhookSecret` returning `env.trim() || null`,
  `isSendblueEnabled`. Mirrors `background-agents/config.ts`.
- `signature.ts` — `verifySendblueWebhook`, cloned from
  `background-agents/signature.ts` (`verifyBackgroundWebhookSignature`),
  constant-time comparison, header name confirmed empirically against a live
  webhook before Slice #266.
- `store.ts` — channel and message CRUD plus `onConflictDoNothing` dedup.
- `readiness.ts` — `getSendblueReadinessChecks` returning `ReadinessCheck[]`
  for `ReadinessVerdict`.
- `router.ts` — decide conversational chat vs. background-gated dispatch;
  verify `channel.userId` / `sessionId` ownership before calling
  `start(runAgentWorkflow, [...])`.
- `types.ts` — Zod schemas and `z.infer` exports.

**New routes:**

- `app/api/channels/sendblue/webhook/route.ts` — clone the GitHub webhook
  handler (`apps/web/app/api/github/webhook/route.ts`): call `req.text()`
  before verification (consuming the stream via `req.json()` would break HMAC),
  `verifySendblueWebhook`, `checkRateLimit` keyed on `to_number`, dedup insert
  `onConflictDoNothing` on `messageHandle`, `after(() => routeInboundMessage(...))`,
  respond 200 fast; respond 410 for Sendblue auto-removal.
- `app/api/channels/sendblue/route.ts` — POST create + link, GET list, PATCH
  binding and guardrails, DELETE.
- `app/api/channels/sendblue/verify/route.ts` — POST send OTP code, POST
  confirm code.
- `app/api/channels/sendblue/test/route.ts` — manual outbound test send.
  Each route uses ownership checks and `checkRateLimit`.

**Routing into the existing chat workflow:** `router.ts` builds a
`WebAgentUIMessage[]` from the inbound body and calls
`start(runAgentWorkflow, [...])` — the same entry point
`app/api/chat/route.ts` uses. Ownership (`channel.userId` / `sessionId`) is
verified before `start`; the workflow does not re-check it.

**Outbound delivery sink:** extend `app/workflows/chat-post-finish.ts` with
`deliverSendblueReply` — a non-fatal `"use step"` export, like
`persistAssistantMessage`. It reads the sticky `fromNumber`, POSTs
`/api/send-message` with `status_callback`, persists an outbound
`sendblueMessages` row, and emits a `channel.sendblue.outbound.*` session event.

**Tool-action path:** in `background_gated` mode, `router.ts` dispatches
through `apps/web/lib/background-agents/dispatcher.ts` so repo and tool actions
hit the existing `requireApproval` gate at `executor.ts:869` (before
`createReadyPullRequestOutput`). Do not bypass it.

**Shared primitives to reuse — do not reinvent:**

- Webhook signature verification: generalize `lib/background-agents/signature.ts`
  into `lib/webhooks/verify-signature.ts`; both the GitHub webhook handler and
  the new Sendblue handler should import from it.
- Redaction: import `redactHarnessPayload` from `apps/web/lib/harness/redaction.ts`
  and add phone/email patterns to the shared redaction primitive at
  `lib/observability/redaction.ts`.
- Observability: import `recordSessionEvent` / `emitSessionEvent` from
  `apps/web/lib/observability/events.ts`; reuse `sessionEvents` table with
  `source: "service"` and the full correlation-ID set.
- Background-agent run machinery: `router.ts` dispatches through the existing
  dispatcher — build no parallel approval concept.

**Settings UI:**

- Add `channels` nav item to `apps/web/app/settings/nav-items.ts` under the
  Tools group (icon `MessageSquare`; `id` must match href slug `channels`).
- New `apps/web/app/settings/channels/page.tsx` — `SettingsPageHeader`
  ("Channels" / "Talk with your agents over iMessage and other channels") +
  `SendblueSection`.
- New `apps/web/app/settings/channels/sendblue-section.tsx` — clone
  `composio-section.tsx`: `ReadinessVerdict` + `SettingsSection` blocks.

**Env:** add `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET_KEY`,
`SENDBLUE_WEBHOOK_SECRET` to `apps/web/.env.example`. Surface names and
presence via `ReadinessVerdict`, never values.

### UX Model

**Entry point:** Settings → Channels (new nav item under the Tools group).

**Primary flow — link + verify (inline InputOTP pattern):**

- A `ReadinessVerdict` block: status dot, headline, and an Operator details
  disclosure listing `SENDBLUE_API_KEY_ID` / `SECRET` / `WEBHOOK_SECRET`
  presence as env-var badges — names only, never values.
- `SettingsSection` "Your iMessage number": a `tel` `Input` + "Send verification
  code" primary button. On send, the button swaps to "Resend code" (30–60s
  cooldown countdown) and reveals an inline 6-slot `InputOTP`
  (`autocomplete="one-time-code"`, aria-label per slot, paste-to-fill). The code
  is sent via Sendblue outbound; the user types it back in the web UI. This
  proves delivery to the number AND that the user controls the web account, and
  avoids the chicken-and-egg of needing the webhook live at Slice #265.
- On confirm, the row collapses to a status chip (`Badge`: Verified = emerald,
  Pending = amber, Unverified = secondary, Failed = destructive) showing the
  number's last-4.
- `SettingsSection` "Which agent answers": a session `Select` + an `agentMode`
  segmented control (Conversational | Repo actions need approval) + a guardrails
  advanced disclosure (`Switch`: allow repo actions, default off).
- "Send test message" button (manual outbound to the verified number).

**Compliance copy (required, near the verify control):** "Msg & data rates may
apply. Reply STOP to cancel. Consent is not a condition of use."

**States:** empty = "Add a number to start texting your agent" CTA (never a dead
control); loading = `SectionSkeleton` matching the card; success = sonner toast
("Number verified" / "Test message sent"); field errors = inline
`text-destructive`; provider/config problems = `ReadinessVerdict` action-needed
(never expose env names in user-facing errors — only in Operator details).

**Transcript:** `SettingsSection` "Recent messages" rendering chat bubbles
(outbound right / `bg-primary`, inbound left / `bg-muted`, `rounded-2xl`,
per-bubble timestamp + delivery tick reflecting real provider `deliveryStatus`,
day-divider `Badge`) inside a `ScrollArea`. Each row links its correlation IDs
for operators. Delivery ticks always reflect real provider state — never faked.

**Reuse:** `SettingsPageHeader`, `SettingsSection` (default + advanced
disclosure), `ReadinessVerdict`, `Badge` status-chip variants, `InputOTP`,
`Select`, `Switch`, `Skeleton`, sonner toasts, chat-bubble pair + `ScrollArea`.
No OAuth-callback `searchParams` cleanup is needed; verification is in-app.

### Security And Safety

- Inbound message bodies are an untrusted prompt-injection surface (attacker-
  controlled, like PR titles). Every persisted body is redacted via
  `redactHarnessPayload` and tagged `redactionStatus`
  (`not_required` / `passed` / `failed` / `blocked`). A redaction failure blocks
  the body from all logs and events.
- Repo and tool actions from inbound messages must route through the
  background-agents `requireApproval` gate (`executor.ts:869`) when
  `agentMode=background_gated` or `guardrails.allowRepoActions` is set. The
  agent never silently pushes from a text.
- Webhook auth: call `req.text()` before verification (consuming via `req.json()`
  breaks HMAC). Use constant-time comparison of `SENDBLUE_WEBHOOK_SECRET`. Fail
  closed if the secret is unconfigured in production (500,
  `"SENDBLUE_WEBHOOK_SECRET is not configured"`).
- Secrets philosophy: `SENDBLUE_API_KEY_ID` and `SENDBLUE_API_SECRET_KEY` are
  toxic raw values. Surface names and presence only in `ReadinessVerdict`
  Operator details — never decrypted values, never in user-facing errors, never
  in logs. `TOKEN_SHAPED` / `SENSITIVE_KEY` redaction patterns in
  `redaction.ts` cover them.
- Sendblue calls are backend-only.
- Ownership is verified before `start(runAgentWorkflow)` in `router.ts`; the
  workflow does not re-check it.
- Rate-limit the public webhook (`checkRateLimit` keyed on `to_number`) and the
  verify and test routes (keyed on `userId`) to prevent OTP and run spam.
- TCPA/consent: surface the opt-in disclaimer near the verify control; consent
  liability is on the deployment operator per Sendblue ToS.

### Failure Modes

| Failure | Mitigation |
|---|---|
| Duplicate webhook delivery → duplicate agent replies | `uniqueIndex` on `messageHandle` + `onConflictDoNothing`; test asserts `created === false` on replay |
| Webhook secret header name undocumented → verification skips or errors | Confirm header empirically before Slice #266; never ship a skip path to production |
| Sticky `from_number` violated → Sendblue rejects or thread breaks | Persist `fromNumber` on first send; always read it before outbound; never pick pool number arbitrarily |
| SMS downgrade with large media silently drops | v1 text-only replies; gate media behind `evaluate-service` preflight in a later slice |
| `was_downgraded === null` truthiness bug | Branch only on `was_downgraded === true` |
| Ownership not verified before `start(runAgentWorkflow)` | `router.ts` resolves and verifies ownership; workflow does not re-check |
| Inbound mutates a repo while bypassing approval | `background_gated` routing through `requireApproval` gate; conversational mode cannot call mutating tools |
| Rate-limit breach (1 msg/sec, 4k/day) | Track per-line counts; emit `channel.sendblue.rate_limited`; surface `action-needed` in `ReadinessVerdict` |
| `after()` callback error → silent inbound drop | Log with `requestId`; emit failed `sessionEvent`; persist `errorKind` on message row |
| Apple/Sendblue line health throttle → outbound silently fails | Mirror `status_callback` delivery states; surface in transcript + `ReadinessVerdict` |
| Contact not pre-registered on AI Agent plan → inbound dropped | Register verified number as a contact via `POST /api/v2/contacts` at link time |

## Implementation Slices

Sequenced minimal-first: inert settings card → shadow inbound → conversational
reply → gated tool actions.

### Slice 1 — #265: Sendblue channel settings card with link + verify + ReadinessVerdict (inert, no inbound)

**Goal:** Ship the operator-facing surface first, fully inert. No webhook, no
inbound routing. Delivers usable operator tooling independently of the
undocumented webhook signature.

**In scope:** Settings → Channels nav item + Sendblue provider card cloned from
`composio-section.tsx`: `ReadinessVerdict` for connection and secret presence
(names only), a `tel` input + `InputOTP` verification flow (server sends the OTP
via Sendblue outbound; user enters it in the web UI), status chip with last-4,
session and `agentMode` binding form with guardrails (default `conversational`,
repo actions off). Persists `sendblueChannels` + `sendblueVerifications`.

**Out of scope:** webhook, inbound, any outbound path except the OTP send and
the "Send test message" button.

**Tests:** `ReadinessVerdict` renders `unavailable` when env vars are absent;
verify route rejects expired or already-consumed OTPs; ownership-gated API
routes reject unauthenticated and cross-user requests; `SendblueSection` renders
empty, loading, and verified states.

### Slice 2 — #266: Sendblue inbound webhook → verified, deduped transcript (shadow, no replies)

**Goal:** Stand up `POST /api/channels/sendblue/webhook`. Prove verification,
dedup, redaction, and transcript UI against real inbound traffic before any
outbound reply is attempted.

**Gating condition:** webhook secret header name and scheme must be confirmed
against a live Sendblue webhook before this slice merges to production. The
verifier must be modeled on `verifyBackgroundWebhookSignature` and fail closed
if `SENDBLUE_WEBHOOK_SECRET` is unconfigured.

**In scope:** `lib/channels/sendblue/signature.ts`, webhook route with
`req.text()` before verify, `checkRateLimit` by `to_number`, `onConflictDoNothing`
dedup on `messageHandle`, persist inbound `sendblueMessages` row with
`redactionStatus`, emit `channel.sendblue.inbound.received` session event,
transcript UI renders real inbound rows.

**Out of scope:** any outbound reply or routing into the chat workflow.

**Tests:** replay of the same `messageHandle` asserts `created === false` and
emits no routing event; redaction failure tags body `blocked`; webhook with
missing or wrong secret returns 500; rate-limit breach returns 429.

### Slice 3 — #267: Conversational reply loop — inbound iMessage drives chat workflow, agent replies over iMessage

**Goal:** Activate the two-way conversational loop. `router.ts` verifies
ownership, builds `WebAgentUIMessage[]` from the inbound body, and calls
`start(runAgentWorkflow, [...])`. Extend `chat-post-finish.ts` with
`deliverSendblueReply` (`"use step"`, non-fatal): read sticky `fromNumber`,
POST `/api/send-message` with `status_callback`, persist outbound
`sendblueMessages` row, mirror delivery state, emit
`channel.sendblue.outbound.*` events.

**In scope:** `lib/channels/sendblue/router.ts`, `deliverSendblueReply` step in
`chat-post-finish.ts`, `app/api/channels/sendblue/test/route.ts`, transcript
rendering full inbound → reply pairs with delivery ticks.

**Out of scope:** tool-action / gated dispatch path (Slice #268).

**Tests:** conversational mode delivers a reply with the correct `fromNumber`;
ownership mismatch blocks `start`; `deliverSendblueReply` failure is non-fatal
and emits an error session event; delivery status update path mirrors provider
state.

### Slice 4 — #268: Repo/tool actions from inbound iMessage routed through the background-agents approval gate

**Goal:** For `agentMode=background_gated` or `guardrails.allowRepoActions`,
route inbound messages that would mutate a repo through the existing
background-agents dispatcher and `requireApproval` gate (`executor.ts:869`).
The agent never silently pushes from an untrusted text. Surface the
`awaiting_approval` state and resulting run URL back over iMessage as a status
reply.

**In scope:** `router.ts` gating logic, dispatcher integration, transcript
links `backgroundAgentRunId`, outbound status reply with run URL.

**Out of scope:** any new approval concept — strictly reuse the existing gate.

**Tests:** `background_gated` inbound reaches `requireApproval` and pauses;
agent does not push to a repo from a text in any code path; `backgroundAgentRunId`
is persisted on the message row and visible in the transcript; `conversational`
mode cannot call mutating tools.

## Open Decisions

1. **Webhook signature scheme is undocumented.** The Sendblue API does not
   document the inbound webhook secret header name or whether it uses HMAC or
   plaintext comparison.
   Recommendation: keep Slice #265 truly inert (OTP-entered-in-web-UI) so it
   ships without resolving this. Confirm the scheme empirically against a live
   webhook before Slice #266 merges. Model on `verifyBackgroundWebhookSignature`;
   fail closed in production if `SENDBLUE_WEBHOOK_SECRET` is unconfigured.

2. **Default `agentMode` for a new channel.** Should new channels default to
   `conversational` or `background_gated`?
   Recommendation: default `agentMode = "conversational"` with
   `guardrails.allowRepoActions = false`. Safest: untrusted inbound can chat but
   cannot mutate anything until the operator explicitly opts into repo actions,
   which then forces the approval gate.

3. **Session topology: one standing session per channel, or a new session per
   inbound burst?**
   Recommendation: one standing session bound at link time (`channel.sessionId`),
   with a new chat per inbound conversation window. Keeps the binding explicit
   and the transcript coherent. Revisit per-conversation sessions only if
   multi-topic threading becomes a problem.

4. **Cold outbound (agent texts first) in v1?**
   Recommendation: no. The Sendblue AI Agent plan is inbound-initiated only.
   Cold outreach requires Enterprise pricing. Scope v1 to inbound-initiated
   conversations plus verification and test sends. Defer proactive outbound to a
   later epic.

5. **Observability: reuse `sessionEvents` or add a channel-specific events table?**
   Recommendation: reuse `sessionEvents` via `recordSessionEvent` / `emitSessionEvent`
   (source: `"service"`). The correlation-ID set already covers all needs; a
   parallel table would violate the platform's single-observability-stack rule.

6. **Shared webhook verify helper: in-place clone or extracted shared module?**
   Recommendation: extract a shared `lib/webhooks/verify-signature.ts` that
   both the GitHub and Sendblue handlers import. The duplication is growing and
   both handlers follow the same constant-time HMAC pattern. Do this in Slice #266.

## Rollout And Rollback

**Rollout — shadow to enforced:**

1. Slice #265 — inert settings card, OTP verify, `ReadinessVerdict`. No
   webhook required. Can ship to production once CI passes and authenticated
   local UI smoke completes.
2. Slice #266 — webhook route deployed but routing is suppressed (shadow). Emit
   `channel.sendblue.inbound.received` events without triggering any agent run.
   Monitor for dedup correctness, redaction failures, and rate-limit breaches
   before enabling routing.
3. Slice #267 — enable conversational reply loop for a small set of operator-
   verified users. Confirm delivery ticks and sticky-sender correctness against
   live traffic before widening.
4. Slice #268 — enable `background_gated` mode. Verify `requireApproval` gate
   is hit for every mutating inbound before enabling for general availability.

**Feature flag / rollback:** the feature degrades gracefully when
`SENDBLUE_API_KEY_ID` or `SENDBLUE_API_SECRET_KEY` is absent —
`isSendblueEnabled` returns false, `ReadinessVerdict` renders `unavailable`,
and the webhook route returns 503. Unset the env vars to disable runtime
integration without a code rollback. Existing `sendblueChannels` and
`sendblueMessages` rows are inert without config.

**Migration rollback:** the three new tables have no FK constraints from existing
tables. They can be dropped without affecting any existing schema surface if the
feature is abandoned before Slice #266 merges.

**Definition of done (all slices):**

- Settings → Channels nav item + Sendblue card built from `SettingsPageHeader` /
  `SettingsSection` / `ReadinessVerdict`, no bespoke cards.
- Link + verify works end-to-end: code sent via Sendblue outbound, entered in
  the web UI, status chip shows last-4 and verified state.
- Inbound webhook verifies the configured secret (constant-time, confirmed
  header, fail-closed in production), rate-limits by `to_number`, and dedups on
  `messageHandle` (replay test asserts `created === false`, no duplicate routing).
- Inbound bodies persisted with `redactionStatus`; redacted in all event
  payloads; redaction failures tagged `blocked`.
- Conversational mode delivers a reply via sticky `from_number`; full
  inbound → reply pair with real delivery state in transcript.
- `background_gated` / `allowRepoActions` inbound routes through the
  background-agents dispatcher and pauses at `requireApproval`; agent never
  pushes from a text. Awaiting-approval state + run URL surface back over
  iMessage.
- Ownership verified before `start(runAgentWorkflow)`.
- Observability uses `sessionEvents` and the shared correlation-ID set; no
  parallel events table.
- Compliance opt-in copy present near verify control.
- Tests-first per behavior; `git diff --check` and `bun --bun run ci` pass.
- Migration `.sql` generated and committed; `apps/web/.env.example` updated.
- Authenticated local UI smoke of the Channels path completed (DB-backed).
