# Cost and usage instrumentation

Status: in progress. This document is the design record for making per-tenant
cost a measured number rather than an inferred one.

## Why

A cost profile of the app produced two figures and one gap.

Measured, from the repository's own production evidence:

- A sandbox at 4 vCPU / 8192 MB costs roughly **$0.10** when hibernation stops
  it normally and **$0.26** if it runs to the 90-minute ceiling. The anchor is
  an invoice line quoted in `apps/web/lib/sandbox/config.ts`: 168 sandboxes on
  the old 5-hour ceiling cost **$119.97**, a mean of $0.714 each, of which
  provisioned memory was $0.709.
- Token spend per user was **unknown**. `usage_events` counted tokens and named
  the model, but carried no cost, and no price book existed to value them
  against.

The compute half was worse: nothing recorded a sandbox's wall-clock or vCPU
anywhere, so the larger, better-understood half of the bill could not be
attributed to a tenant at all.

Any pricing decision — an ad-supported tier, a free tier, a quota — is priced
against a cost that cannot currently be seen. This work makes it visible.

## What shipped

### 1. Token cost per user per model

- **`model_prices`** — an effective-dated price book. `cost` mirrors the exact
  shape the Vercel AI Gateway publishes (`AvailableModelCost`: USD per million
  tokens, with an optional `context_over_200k` tier), so the catalogue is
  snapshotted verbatim and never hand-authored. Rows are append-only; a price
  change supersedes rather than mutates.
- **`usage_events.cost_usd`**, `pricing_status`, `model_price_id` — the value of
  a turn's tokens, **stamped at write time** in `recordUsage`, together with the
  id of the price row that produced it.
- **`lib/usage/pricing.ts`** — delegates the arithmetic to the existing
  `estimateModelUsageCost`, so the two rules that are easy to get wrong (cached
  reads are billed at their own rate and deducted from uncached input; models
  with a long-context tier switch rates above 200k input tokens) have exactly
  one implementation.
- **`getModelCostRollup` / `getCostCoverage`** — per user per model, with the
  gateway/BYO-key split, summed as `numeric` in SQL.

Two decisions worth keeping:

**Stamped, not computed on read.** Prices change. A rollup of last month must
not silently restate itself because a vendor repriced today.

**Coverage travels with every total.** `pricing_status` records *why* a row has
no cost, so a total is always readable next to the share of events that could be
priced. A total with 40% coverage is not a total, and nothing in the number
itself would say so.

### 2. Sandbox compute per span

- **`sandbox_usage_events`** — one row per sandbox lifetime, not per session. A
  session hibernates and resumes, and each of those is a separate billing span.
- **`packages/sandbox/meter.ts`** — an open/close hook at the package boundary.
  `connectSandbox` is called from about fifty places, and the overwhelming
  majority are *reconnects* to a VM that is already running and already billed;
  metering per call site would count the same VM many times over.
- Attribution is passed in by the caller (`VercelSandboxConfig.meter`), because
  the package has no database and a sandbox name is not a user. Only the few
  sites that genuinely create a sandbox pass it.

Two honesty constraints encoded in the schema:

- **Active CPU is not observable** from inside a sandbox. `active_cpu_seconds`
  stays NULL and `estimated_cost_usd` covers provisioned memory plus the
  creation fee only. On the measured sample, memory was $0.709 of $0.714 per
  sandbox, so the figure is a close lower bound — and the column name says
  "estimated" because the CPU term is genuinely missing.
- **The reconnect path opens no span.** vCPU is fixed at creation and is not
  recoverable on reattach, and vCPU is what memory cost derives from. A guessed
  input to a cost figure is worse than a missing span: the gap is visible, the
  guess is not.

## What this does not do yet

### Model choice and tenant policy

Today model access is entirely a *user preference*: `userPreferences`
(`defaultModelId`, `defaultSubagentModelId`, `enabledModelIds`,
`modelVariants`, `defaultInferenceProfileId`) lets a user enable any model in
the gateway catalogue. There is no operator-side policy, and no spend bound.

For a multi-tenant product that is the missing layer, and it is deliberately not
in this change. What it needs:

1. **Price visible at the point of choice.** The catalogue already carries
   per-model cost; the model pickers do not show it. Users pick models blind,
   which is the cheapest possible place to fix a cost problem.
2. **Their own spend, per model.** `getModelCostRollup` provides the data; the
   usage settings page does not surface cost yet.
3. **A tier and an allowlist.** `enabledModelIds` is a preference a user sets.
   A plan needs a model allowlist and a spend cap that a user *cannot* set,
   enforced server-side where the model is resolved
   (`lib/inference/profile-resolution.ts`), not in the UI.
4. **BYO key as the free-tier escape hatch.** Already built: an inference
   profile routes inference to the user's own key (`inferenceRoute: "user"`),
   which is why the rollup splits platform spend from user-key spend. A free
   tier that requires BYO inference leaves the platform paying only sandbox
   cost.

### Backfill

Existing `usage_events` rows have no cost and will report `no_price`. They can
be valued retroactively once the price book is populated, but only against a
price whose `effective_from` genuinely covers the event — otherwise the backfill
invents history. Not attempted here.

### Price book population

`planModelPriceSync` / `applyModelPriceSync` exist and are tested, but nothing
calls them on a schedule yet. Until the price book has rows, every event records
`unknown_model` — which is the correct, visible behaviour for "we have no
published price", not a silent zero.
