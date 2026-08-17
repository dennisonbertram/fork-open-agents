# UI References

External design work worth borrowing from. Each entry says what it is, what it
actually covers, and what is unverified — so nobody adopts something on the
strength of a link.

---

## Beautiful UI — <https://www.beautifului.dev/>

A component library of "crafted primitives" for **AI-native interfaces**:
applications built around agents and assistants. MIT licensed, copy-paste
rather than a package install. Credited to the design studio Turbo.

This is unusually close to what this repository builds. Most component
libraries give you buttons and dialogs; this one names the surfaces an
agent product actually needs, and we already have hand-rolled versions of
most of them.

### The 19 components it lists

Loading State · Thinking (with expandable traces) · Streaming Text ·
Approval Card · Tool Chips · Task Rows · Chat Composer · Prompt Bar ·
Recommendation Card · Context Cards · Diff Table · Records Table ·
Filter Table · Sidebar Nav · Search · Insight Cards · Code Block ·
Fine-tune Card · Selection Actions

### Where they map onto this codebase

Checked against the tree, not guessed:

| Their primitive | Ours today |
| --- | --- |
| Thinking (expandable traces) | `components/thinking-block.tsx` |
| Streaming Text | the AI SDK stream + `lib/chat/stream-recovery-policy.ts` |
| Approval Card | `components/tool-call/approval-buttons.tsx` |
| Tool Chips | `components/tool-call/*`, `tool-calls-summary-bar.tsx` |
| Task Rows | `components/pinned-todo-panel.tsx` |
| Chat Composer | the composer inside `session-chat-content.tsx` |
| Diff Table | `diff-tab-view.tsx`, `diff-viewer.tsx`, `@pierre/diffs` |
| Sidebar Nav | `components/inbox-sidebar.tsx`, `workspace-navigation.tsx` |
| Search | `cmdk` comboboxes, `slash-command-dropdown.tsx` |
| Code Block | **no direct equivalent** — markdown rendering goes through `streamdown` |

Nothing here maps to Records Table, Filter Table, Insight Cards, Fine-tune
Card, Recommendation Card, or Selection Actions. Those are the ones worth
looking at first precisely because we have not built them — `/runs` and
`/automations` are both list-and-filter surfaces assembled ad hoc.

### What is NOT verified

- **The framework is not stated on the site.** It does not say React, Vue,
  Tailwind, or shadcn anywhere on the landing page. Do not assume it drops
  into this stack until someone has opened the actual component source.
- Copy-paste is inferred from "copy-paste ready" on the page, not from having
  installed anything.
- The MIT licence is stated on the page and has not been checked against a
  `LICENSE` file in whatever repository backs it.

### How to use this entry

As a **reference for what good looks like**, not a dependency to adopt. The
useful exercise is comparing their treatment of a surface against ours — the
approval card, the thinking trace, the diff table — and stealing the ideas that
are better. Any actual adoption needs the framework question answered first.

Relevant when working on the surfaces catalogued in
[`docs/ux-paths/browser/`](../ux-paths/browser/discovery.md), particularly the
chat loop and the runs/automations list views.
