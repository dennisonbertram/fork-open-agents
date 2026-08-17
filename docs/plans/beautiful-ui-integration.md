# Beautiful UI Integration Plan

Durable record: **issue #1331** (`/runs` and `/automations` are not triageable).
This plan expands that issue. It does not replace it.

Related: [`docs/design/ui-references.md`](../design/ui-references.md),
[`docs/ux-paths/browser/topics/runs-automations.md`](../ux-paths/browser/topics/runs-automations.md)
(STORY-801 to STORY-814).

---

## 1. Recommendation

**Do not add the registry. Do not run `shadcn add` against it. Hand-port at
most one component, and only after the first two slices land.**

The stronger finding is upstream of the library question:

> **None of the three defects in #1331 needs a new component.** The data they
> ask for is already in the API payload. The list row does not print it.

`attentionReasons` is a field on `NormalizedAutomationRun`
(`apps/web/lib/runs/types.ts:66`), it is populated for every branch of
`normalizeRunStatus` (`apps/web/lib/runs/status.ts`), and it already arrives in
the browser — the existing test fixture carries `attentionReasons: ["stale"]`
(`apps/web/app/runs/runs-list.test.tsx:26`). `RunDimensions`
(`apps/web/app/runs/runs-list.tsx:45-70`) renders `state`, `outcome` and
`health`, and drops the reasons.

The first rung of the ladder holds. The fix is a render change of about ten
lines. A component library is not on the critical path for #1331.

### Why not `shadcn add`

Four reasons, in order of weight:

1. **Supply chain.** `TurboKach/ai-native-react-components` was created
   2026-08-12, has 9 stars, one push, and no maintenance history. `shadcn add`
   executes a fetch-and-write against a URL the author controls at the moment
   we run it. The risk is not the code we read today; it is the code at the
   next `add`. A registry this new has no revocation story and no second
   maintainer.
2. **Licence ambiguity, unresolved.** The `LICENSE` file credits "Turbo". The
   site's `/license` page says MIT, copyright Shane Levine. Two different
   copyright holders for the same MIT grant is not a blocker for reading the
   source, but it is a reason not to vendor files wholesale with their headers.
3. **Primitive mismatch.** Their components hand-roll dropdowns and checkboxes
   with `useState`. Ours are Radix. `apps/web/components/ui/` is the shared
   vocabulary of this app — 36 files, all Radix or Radix-adjacent. Adding
   non-Radix siblings there splits focus management, keyboard behaviour and
   accessibility semantics inside one directory.
4. **Two of the six novel components do not compile as published.** Records
   Table needs about 85 hand-authored `.records-*` CSS rules that the copied
   output omits. Selection Actions imports `iconoir-react` plus two internal
   modules absent from the public payload.

`apps/web/components.json` currently has `"registries": {}` and
`"iconLibrary": "lucide"`. Keep both as they are.

*Unverified:* whether `iconLibrary` in shadcn 3.5 remaps arbitrary third-party
icon imports, or only shadcn's own lucide/radix pair. We do not need the answer
under this recommendation. Check it before any future `shadcn add`.

### What we do instead

Read their source as a **design reference**. Port ideas, not files. Reuse
`apps/web/components/ui/badge.tsx` and `table.tsx`, which already exist.

---

## 2. What #1331 actually needs

Three bullets in the issue, checked against source:

| #1331 claim | Verified state | Needs a component? |
| --- | --- | --- |
| Attention reasons computed but never rendered on list rows | **Confirmed.** `RunDimensions` renders 3 of 4 dimensions. | No |
| One run reachable at 5 live URLs (10 across both sources) | **Confirmed** (STORY-802). This is routing, not UI. | No |
| Filtered-empty and new-user-empty look identical | **Not confirmed as written.** See below. | No |

### Correction to the third claim

`runs-list.tsx:364-380` already renders two different empty states: "No runs
yet" with a "Create an Automation" call to action, and "No runs found" with
"Clear filters". `automations-list.tsx:387-405` does the same with "No
automations configured" and "No automations match these filters". Both are
covered by tests (`runs-list.test.tsx:197-217`,
`automations-list.test.tsx:183`).

There **is** a real defect nearby, and it is narrower. `isFiltered`
(`runs-list.tsx:221-223`) treats any query parameter as a filter, except
`view=all`. So a brand-new user with zero runs who clicks the **Active** tab
sees "No runs found — Try another status or clear the repository and trigger
filters" and a "Clear filters" button, for filters they never set. A status tab
is a view, not a filter.

Restate the #1331 bullet as that, and it becomes testable.

---

## 3. Slice order

Ordered by user value per line of diff. Slices 1 and 2 do not touch the same
file region as each other, but both edit `runs-list.tsx`, so they are
**sequential, not parallel**.

| Slice | Work | New deps | Component from Beautiful UI |
| --- | --- | --- | --- |
| 1 | Render attention reasons on `/runs` rows | none | none |
| 2 | Stop treating a view tab as a filter in the empty state | none | none |
| 3 | Reassess. Measure whether triage still fails. | — | — |
| 4 (conditional) | Hand-port **Filter Table** into the `/runs` filter form | none | ideas only |
| never | Records Table, Selection Actions, Fine-tune Card, Insight Cards, Recommendation Card | — | — |

Slice 3 is a real gate, not a formality. If a user can triage `/runs` after
slices 1 and 2, slice 4 does not get built. The URL-redundancy defect
(STORY-802) is routing work and belongs in its own issue; it is out of scope
here because no component fixes it.

---

## 4. The first slice (PR-sized)

### Why this matters

A run whose health is `needs_attention` because it **failed** is visually
identical, on the list, to one that is `needs_attention` because it is
**stale** (STORY-801 edge case, STORY-803 edge case). Both show the same red
"Needs attention" badge. The reason exists in the payload. A user must open the
detail page to read one word. That is the fourth step in STORY-801 and the
third in STORY-803.

### User path protected

`/runs?view=attention` → decide which row to open first, without opening any
row.

### Behaviour contract

1. When a run has `attentionReasons: ["stale"]`, the list row shows the text
   "Stale".
2. When a run has `attentionReasons: ["failed_steps"]`, the row shows "Failed
   steps" **and** the `Succeeded` outcome badge at the same time (STORY-809 —
   this combination is the whole point of the tab).
3. When a run has `attentionReasons: []`, no reason chip renders.
4. When a run has more than one reason, every reason renders.
5. Reason text is distinct from health text. A row never shows "Needs
   attention" as its only explanation.

### Files

| File | Change |
| --- | --- |
| `apps/web/app/runs/runs-list.tsx` | Extend `RunDimensions` to render reason chips |
| `apps/web/app/runs/attention-reason-label.ts` | **new** — `Record<RunAttentionReason, string>` |
| `apps/web/app/runs/attention-reason-label.test.ts` | **new** — the source guard, see §6 |
| `apps/web/app/runs/runs-list.test.tsx` | Add the five assertions above |

The label map goes in its own file, not at the bottom of `runs-list.tsx`, per
the file-organisation rule in `CLAUDE.md`. It is data, and the guard test needs
to import it without importing a client component.

Do **not** reformat the existing badge spans in the same PR. Reuse
`components/ui/badge.tsx` for the new chips only if it renders without a class
override; if it needs overriding, match the existing sibling spans instead. A
badge-consistency cleanup is separate work.

### Tests to write first, and confirm red

In `apps/web/app/runs/runs-list.test.tsx`, following the existing
`renderToStaticMarkup` + mocked-SWR pattern already in that file:

- `expect(html).toContain("Stale")` against the existing `bg-1` fixture, which
  already carries `attentionReasons: ["stale"]`. **This must fail before the
  change.** It is the cheapest possible red.
- A new fixture with `outcome: "succeeded"`, `health: "warning"`,
  `attentionReasons: ["failed_steps"]` asserting both "Succeeded" and "Failed
  steps" appear. This is the STORY-809 combination and the one no current test
  covers.
- A fixture with two reasons, asserting both render.
- The `loop-run-1` fixture already has `attentionReasons: []`; assert the chip
  container does not render for it.

Run `bun test apps/web/app/runs/runs-list.test.tsx` and record the red output
in the test-only commit.

### Out of scope for slice 1

Filtering by attention reason. Changing badge colours. Touching
`/automations`. Touching the detail pages. Any routing change. Any new
dependency.

### Observability

None. This slice adds no event, no network call and no error path. It renders a
field that is already fetched. Saying "reuse existing observability" would be
the weak answer the ticket format warns about; the honest answer is that this
slice has no observability surface at all.

### Deploy impact

None. No migration, no environment variable, no new service.

---

## 5. The icon conflict

`iconoir-react` does not enter this repository. `lucide-react` is already the
declared `iconLibrary` and is used across the tree, including
`runs-list.tsx:3`.

When a ported component references an Iconoir glyph, substitute the nearest
lucide equivalent by hand at port time. This is a per-import decision, roughly
one line each, and it is cheaper than carrying a second icon set. Do not write
a mapping layer — there is no second consumer.

If a specific Iconoir glyph has no acceptable lucide equivalent, drop the icon.
None of the six candidate components depends on an icon for meaning.

---

## 6. What tests cannot see, and the guard

Per [`reviewing-what-tests-cannot-see.md`](../process/reviewing-what-tests-cannot-see.md):

**Blind spot 2 — combinations.** The union `RunAttentionReason` has 8 members
(`types.ts:24-32`). A test asserting three of them says nothing about the other
five. Worse, the union has been widened repeatedly: the comments in `status.ts`
record three separate widenings (#1241, #1247, #1288), each of which silently
degraded runs to `unknown` until a branch was added. A reason added to the
union with no label would render blank or crash, and no behavioural test would
catch it, because no fixture would exist for it.

**The guard is a type, not a test.** Declare the label map as
`Record<RunAttentionReason, string>`. Adding a ninth reason to the union then
fails `turbo typecheck` until a label exists. That is cheaper and stricter than
any runtime assertion.

Back it with one small test that iterates `Object.keys` of the map and asserts
every value is a non-empty string that is not the raw snake_case key. This
catches the lazy escape hatch of adding `blocked: ""` to satisfy the type.

**Mutation-test it before trusting it**, per the same doc: remove one key from
the record, observe `turbo typecheck --filter=web` fail, restore, observe it
pass. Record the observed failure text in the commit message. This repo has
shipped guards that were green and inert.

**What no test covers:** whether the reason wording is intelligible to a user,
and whether five chips on one row are legible at narrow widths. Those need
`agent-browser` on `/runs?view=attention` with a seeded attention run, per the
authenticated local UI smoke gate. State plainly in the PR if that smoke was
blocked and why.

---

## 7. What we are not taking, and why

| Component | Decision | Reason |
| --- | --- | --- |
| **Records Table** | No | Depends on ~85 hand-authored `.records-*` CSS rules absent from the copied output. We would be reimplementing it, not adopting it. `components/ui/table.tsx` already exists. |
| **Selection Actions** | No | Does not compile as published: imports `iconoir-react` plus two internal modules missing from the public payload. Also, `/runs` has no multi-select and no bulk action to attach it to. Speculative. |
| **Fine-tune Card** | No | Misleadingly named — it is a settings/inspector widget. `components/ui/settings-section.tsx` and `settings-group.tsx` already cover this. |
| **Insight Cards** | No | A single-card pager, not a grid. `/runs` needs a dense list, which is the opposite affordance. |
| **Recommendation Card** | No | No surface asks for it. YAGNI. |
| **Filter Table** | Deferred to slice 4, ideas only | Genuinely the cleanest: self-contained, pure Tailwind, zero dependencies. But `/runs` already has a working filter form (`runs-list.tsx:261-322`). Rebuild it only if slice 3 shows filtering is still the bottleneck. |
| The nine with existing equivalents | No | Thinking block, approval buttons, tool chips, todo panel, composer, diff viewer, sidebar nav, cmdk search, streaming. Replacing working, tested components with unversioned copies trades known behaviour for unknown behaviour and gains nothing a user can see. |

---

## 8. Risks, stated plainly

1. **Supply chain — the largest risk, and the reason for the recommendation.**
   A 5-day-old, 9-star, single-author, single-push registry with a contradictory
   licence attribution is not a dependency. Under this plan we take zero code
   from it and zero install-time execution, so the residual risk is zero. Any
   later decision to run `shadcn add` against it reopens this in full and needs
   its own research-spike issue.
2. **Slice 4 never happens, and that is a success, not a failure.** If slices 1
   and 2 make `/runs` triageable, the library was correctly not adopted. Do not
   build slice 4 to justify this document.
3. **The chip count on a row is unbounded in principle.** `attentionReasons` is
   an array. In practice every branch of `normalizeRunStatus` returns zero or
   one reason today (verified — read all nine return statements). A future
   branch could return several. The behaviour contract covers the multi-reason
   case so the layout is exercised before it happens in production.
4. **This plan corrects one bullet of #1331.** The empty-state claim is not
   accurate against current source. Update the issue rather than implementing
   against the stale wording, or slice 2 will fix something that already works
   and miss the tab-versus-filter defect that does not.
</content>
</invoke>
