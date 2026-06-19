# Mobile design — concept reference

The original mobile concept for the `/m` route group, designed in Pencil
(`open-agents-mobile.pen`, kept in the Pencil workspace — not in this repo since
`.pen` files are encrypted). These exports are the durable, viewable reference.

The concept was **corrected to use the app's real design system** — it is
**monochrome** (primary actions use `--primary`, not a colored accent), with
status tones reusing `--warning` (Working / Waiting), `--success` (Done), and
`--destructive` (Error). See `design.json` for the token mapping and per-screen
structure.

| Screen | Route | Image |
| --- | --- | --- |
| Activity / inbox | `/m` | [`activity.png`](./activity.png) |
| Chat (with tool approval) | `/m/chat/[chatId]` | [`chat.png`](./chat.png) |
| New session | `/m/new` | [`new-session.png`](./new-session.png) |
| Tab bar (component) | — | [`tab-bar.png`](./tab-bar.png) |

This is an **IA / layout reference**, not a pixel spec. The shipped
implementation lives under `apps/web/app/(mobile)/m/*` and
`apps/web/components/mobile/*` and uses the app's tokens directly; see
[`docs/plans/mobile-view.md`](../../plans/mobile-view.md) and
[`docs/ux-paths-mobile/catalog.md`](../../ux-paths-mobile/catalog.md).
