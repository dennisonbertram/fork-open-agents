# Research Brief: Visual & Interaction Design for the open-agents iOS App (June 2026)

**Scope:** Design research (visual + interaction) for the native Swift/SwiftUI iPhone+iPad client of open-agents: an agentic-coding companion (streaming AI-agent chat, tool-call observation, session/repo/settings management) targeting iOS 26 / iPadOS 26 with native Liquid Glass.
**Date:** 2026-06-10. **Author:** research subagent.
**Research tools used:** Perplexity MCP (`perplexity_ask` with high search context, `perplexity_search`) for HIG/WWDC synthesis and app teardowns; WebFetch against `developer.apple.com` (HIG pages are JS-rendered and returned no content directly, so Apple guidance below is sourced via Perplexity-grounded citations to the same Apple URLs plus the verified facts already in `docs/plans/ios-app/research/20-swift-app-architecture.md`). **Mobbin MCP tools were not available in this environment** (ToolSearch found no match), so screenshot-level flow audits of competitor apps rely on published teardowns and reviews rather than Mobbin captures. Claims marked *(observational)* come from product walkthroughs/reviews rather than primary vendor documentation.

**One grounding fact from this repo:** the web product review identified the streamed agent run — reasoning block → collapsible tool cards (Read/Edit/Write/shell) with pending→success/error states and inline stdout — as "the single best-loved surface" (`docs/plans/ios-app/research/09-web-ux-inventory.md`, section A3). The iOS design's first job is to make that surface feel *better* than the web, not merely present.

---

## Leading summary

- **Liquid Glass has hard rules, and they are few:** glass is for the floating chrome layer (tab bar, toolbars, composer container, floating pills); content (transcript, code, diffs, forms) stays opaque; never stack glass on glass; nearby glass shapes must share one `GlassEffectContainer`. Following these four rules gets 90% of "feels like iOS 26" for free, because standard SwiftUI chrome is already glass on the iOS 26 SDK.
- **The system gives us the design system:** SF Pro + SF Mono via `Font.system(design:)`, the Dynamic Type text styles, semantic colors (`Color.primary`, `UIColor.systemBackground` family), SF Symbols, spring animations, and `.sensoryFeedback`. The visual identity proposal below is deliberately thin: one accent (system indigo), four status colors, two diff colors, and a strict glass-usage map. Everything else is system-default on purpose.
- **The hardest design problem is the streaming transcript:** scroll anchoring (pin-to-bottom unless the user scrolls up), zero layout jumps while tokens arrive, tolerant Markdown rendering across half-open code fences, collapsible tool-call rows, and a single completion haptic. Section 5 specifies the exact behaviors; the architecture brief (`20-swift-app-architecture.md` §3.3) already specifies the state isolation that makes them implementable.
- **Competitors define the bar:** ChatGPT's blank-composer-as-invitation and outcome-labeled model picker; Claude's calm restraint; GitHub Mobile's unified-diff PR review (the proof that code review works on a phone); Linear's token discipline; Slack's thumb-reachable bottom search and its cautionary tale about density.
- **Accessibility is load-bearing, not bolt-on:** VoiceOver must announce a streamed message once (on completion), not per token; Dynamic Type up to AX5 must not break the composer or tool rows; Reduce Transparency/Motion fallbacks come free only if we use system glass APIs and gate custom motion on the environment values.
- The brief closes with six named **design pillars**, five named **signature interactions**, and a concrete **visual identity direction** (color tables, type scale table, SF Symbols policy, glass-usage map) — all written so a weak coding model can apply them mechanically.

---

## 1. Liquid Glass and the iOS 26 HIG

### 1.1 What it is

- Liquid Glass is Apple's iOS 26 material for **controls and navigation**: "a dynamic material … allowing you to present controls and navigation without obscuring the content beneath" (HIG Materials, https://developer.apple.com/design/human-interface-guidelines/materials).
- It refracts/reflects underlying content, adapts light↔dark as content scrolls beneath it, and is applied automatically to all standard chrome (nav bars, toolbars, tab bars, sheets, alerts, popovers, sidebars, standard buttons) when the app is built with the iOS 26 SDK (Adopting Liquid Glass, https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass).
- **Two variants** — `regular` and `clear` — selectable when building custom components (HIG Materials). `regular` is the default: stronger material presence, better legibility over busy content. `clear` is lower-opacity for cases where content must dominate (e.g., controls over full-bleed media); it generally needs a dimming layer behind it to keep symbols legible.

### 1.2 The rules (do/don't)

| # | Rule | Source |
|---|---|---|
| G1 | Glass is for the **floating control layer** (toolbars, tab bars, floating buttons/pills, composer chrome); the **content layer stays opaque** | HIG Materials; WWDC25 "Build a SwiftUI app with the new design" (https://developer.apple.com/videos/play/wwdc2025/323/) |
| G2 | **Never stack glass on glass** — a glass element must not render above another glass element | WWDC25 323; Adopting Liquid Glass |
| G3 | Multiple glass shapes near each other **must share one `GlassEffectContainer`** ("essential for visual correctness", and a performance requirement) | WWDC25 323 |
| G4 | Default shape of `.glassEffect()` is a **capsule**; pass an explicit shape for anything else: `.glassEffect(.regular, in: .rect(cornerRadius: 16))` | WWDC25 323 |
| G5 | **Tint glass only for emphasis** (primary action, active/recording state); default is untinted. Unioned glass controls must share one tint | WWDC25 323; https://www.donnywals.com/grouping-liquid-glass-components-using-glasseffectunion-on-ios-26/ |
| G6 | Remove custom bar backgrounds/tints so content scrolls **under** the glass; use `ToolbarSpacer` to group toolbar items | Adopting Liquid Glass |
| G7 | Morph transitions between glass shapes use `glassEffectID(_:in:)` + a shared `@Namespace` inside one container | WWDC25 323; https://www.createwithswift.com/morphing-glass-effect-elements-into-one-another-with-glasseffectid/ |
| G8 | Reduce Transparency → system makes glass more opaque; Reduce Motion → morphs are toned down. **Both come free only via the system APIs** — never fake glass with custom blur layers | HIG Materials; WWDC25 323 |
| G9 | Interactive glass elements (buttons) use `.interactive()` on the glass style, or `buttonStyle(.glass)` / `.glassProminent` | WWDC25 323 |

### 1.3 Cautions

- **NN/g's usability review of Liquid Glass** flags legibility risk when glass sits over busy content and when apps over-apply it to content cards (https://www.nngroup.com/articles/liquid-glass/). Practical consequence for this app: prefer `regular` over `clear` everywhere; the transcript behind the composer is high-density text, the worst case for clear glass.
- Glass is a system; resist the temptation to make message bubbles, code blocks, or cards glassy. The web app's loved tool cards translate to **opaque** rows on iOS (see §5.5 and the glass map in §11.4).

### 1.4 Scroll-edge effects and the app icon

- **Scroll-edge behavior is automatic and must not be defeated.** With the iOS 26 SDK, content scrolls *under* floating glass bars and the material adapts (light↔dark, contrast) based on what is beneath it (WWDC25 323). Implementation rules: never pin an opaque header over the transcript; never set `.toolbarBackground(...)` to a solid color; let the transcript's first/last rows pad themselves with `safeAreaInset`/`contentMargins` rather than fake spacer views, so glass always has real content to refract.
- The tab bar may use `tabBarMinimizeBehavior(.onScrollDown)` so reading a long transcript shrinks chrome; the composer remains full-size (input must never minimize).
- **App icon:** must be layered Icon Composer artwork with default/dark/clear/tinted variants — a flat pre-rendered PNG looks visibly wrong on iOS 26 home screens (Adopting Liquid Glass; see also `docs/plans/ios-app/research/20-swift-app-architecture.md` §2.3). Direction consistent with §11: indigo-on-dark glyph, geometry derived from the `sparkles` + terminal-prompt motif, no wordmark (text in icons fails at small sizes and violates HIG app-icon guidance, https://developer.apple.com/design/human-interface-guidelines/app-icons).

---

## 2. Typography, color, spacing, dark mode

### 2.1 Typefaces

- **SF Pro** for all UI text. Optical sizing (Text ≤19pt, Display ≥20pt) is automatic when using `Font.system` / text styles — never embed font files (HIG Typography, https://developer.apple.com/design/human-interface-guidelines/typography; https://developer.apple.com/fonts/).
- **SF Mono** for code, diffs, logs, paths, commit SHAs, branch names. On iOS it is reached via `Font.system(.body, design: .monospaced)` (the system monospaced font is SF Mono); no bundling needed.
- **`.monospacedDigit()`** on any numeral that updates in place: elapsed-run timers, token/cost counters, usage numbers. Prevents width-jitter as digits change.
- Never use a custom display typeface. The identity comes from restraint, color, and motion, not type novelty (this mirrors OpenAI's own Apps SDK rule "don't use custom fonts", https://developers.openai.com/apps-sdk/concepts/ui-guidelines).

### 2.2 Dynamic Type scale (defaults at the Large content size)

| Text style | Size/weight (Large) | Use in this app |
|---|---|---|
| `largeTitle` | 34pt | Screen titles on settings root, onboarding hero |
| `title` | 28pt | Rarely; empty-state headlines |
| `title2` | 22pt | Section headers on iPad detail panes |
| `title3` | 20pt | Sheet titles |
| `headline` | 17pt semibold | Session titles in lists, message sender line |
| `body` | 17pt | Message text, form rows |
| `callout` | 16pt | Tool-call row titles; **code at `.system(.callout, design: .monospaced)`** |
| `subheadline` | 15pt | Repo/branch metadata lines |
| `footnote` | 13pt | Timestamps, tool-call summaries |
| `caption` | 12pt | Badges (model pill), status chips |
| `caption2` | 11pt | Cost badges, char counts |

Source for the scale: HIG Typography (sizes verified against the published iOS table). Rule: **specify only text styles, never point sizes**, except inside the DesignSystem token file where `@ScaledMetric(relativeTo:)` anchors non-text dimensions (§7.2).

### 2.3 Semantic colors

- Text: `Color.primary` / `.secondary`; UIKit-bridged `UIColor.label`, `.secondaryLabel`, `.tertiaryLabel`, `.quaternaryLabel` where finer hierarchy is needed.
- Surfaces: `UIColor.systemBackground` → `.secondarySystemBackground` → `.tertiarySystemBackground` (and the `…GroupedBackground` triplet for grouped lists/settings). These encode the **base vs elevated dark-mode** behavior automatically — dark base is pure black `#000000`, first elevation `#1C1C1E`, second `#2C2C2E`; light is `#FFFFFF` / `#F2F2F7` (HIG Color, https://developer.apple.com/design/human-interface-guidelines/color; HIG Dark Mode, https://developer.apple.com/design/human-interface-guidelines/dark-mode).
- Hairlines: `UIColor.separator` / `.opaqueSeparator`. Tint: SwiftUI `.tint(...)`, set once at the app root.
- **Hardcoded hex anywhere outside the token file is a defect**: it breaks dark mode, Increase Contrast, and vibrancy-on-glass. The only raw values allowed live in the asset catalog color sets defined in §11.1, each with explicit Any/Dark (and where needed High Contrast) variants.

### 2.4 Contrast and dark mode

- WCAG AA minimums: **4.5:1** for body text, **3:1** for large text (≥18pt regular / ≥14pt bold) (https://www.w3.org/WAI/WCAG22/Techniques/general/G18). All custom colors in §11.1 must pass these against their stated backgrounds in both modes — make it a snapshot/unit test in the DesignSystem package.
- Dark mode is the developer default; design dark-first, verify light. Use elevated backgrounds (`secondarySystemBackground`) for cards/panels rather than borders; in dark mode elevation *is* the separation.
- Code blocks and diffs get their own background tokens (§11.1) tuned so syntax colors keep ≥4.5:1 in both modes.

### 2.5 Spacing and hit targets

- **8pt spacing grid**: all paddings/margins/gaps are multiples of 4 with 8/12/16 as the workhorses (HIG Layout, https://developer.apple.com/design/human-interface-guidelines/layout).
- **44×44pt minimum touch targets** for anything tappable (HIG Accessibility/Layout). Tool-call disclosure chevrons, copy buttons, and message-action icons must use `.contentShape(Rectangle())` + padding to reach 44pt even when glyphs are smaller.

### 2.6 Token implementation sketch

So that "use the token" is unambiguous for a weak model, the design-system package exposes tokens as namespaced statics — feature code composes them, never raw values:

```swift
// ios/Packages/OpenAgentsDesignSystem/Sources/OpenAgentsDesignSystem/Tokens.swift
public enum OASpacing {
  public static let xs: CGFloat = 4
  public static let sm: CGFloat = 8
  public static let md: CGFloat = 12
  public static let lg: CGFloat = 16
  public static let xl: CGFloat = 24
}

public extension Color {
  static let oaAccent = Color("AccentPrimary", bundle: .module)
  static let oaStatusRunning = Color("StatusRunning", bundle: .module)
  static let oaStatusSuccess = Color("StatusSuccess", bundle: .module)
  static let oaStatusError = Color("StatusError", bundle: .module)
  static let oaCodeBackground = Color("CodeBackground", bundle: .module)
  // ... one static per §11.1 token, nothing else
}

public enum OAType {
  public static let message: Font = .body
  public static let toolRow: Font = .callout
  public static let code: Font = .system(.callout, design: .monospaced)
  public static let badge: Font = .caption2.monospacedDigit()
}
```

Lint rule for review (grep-able): `Color(red:`, `Color(hex`, `#[0-9A-Fa-f]{6}` and `Font.system(size:` must not appear under `ios/Packages/OpenAgents*Feature*` or the app target — only inside the DesignSystem package.

---

## 3. Motion and haptics

### 3.1 Springs are the default

- Springs are SwiftUI's default animation; Apple's model is **duration + bounce**, with "bounce 0 … a great general-purpose animation" (WWDC23 "Animate with springs", https://developer.apple.com/videos/play/wwdc2023/10158/).
- Presets: `.smooth` (no bounce), `.snappy` (small bounce), `.bouncy` (more bounce); all accept `duration:`/`extraBounce:`.
- House rules for this app:
  - Micro-interactions (chip expand, button states): `.snappy(duration: 0.2)`.
  - Content/layout transitions (rows appearing, panel changes): `.smooth(duration: 0.3)`.
  - The only `.bouncy` in the app is the signature send moment (§10 S1).
  - Springs animate **user-driven** changes only. Continuous/system activity (progress, streaming) uses steady indicators, never bouncing ones (https://www.createwithswift.com/understanding-spring-animations-in-swiftui/).
  - Never animate per-token text changes; transcript text appends without animation (animation here causes shimmering reflow — §5).

### 3.2 Haptics vocabulary

SwiftUI `.sensoryFeedback(_:trigger:)` is the only haptics API used in app code (it wraps `UIImpactFeedbackGenerator` light/medium/heavy/soft/rigid, `UINotificationFeedbackGenerator` success/warning/error, `UISelectionFeedbackGenerator`). Kinds available: `.impact`, `.success`, `.warning`, `.error`, `.selection`, `.increase`, `.decrease`, `.start`, `.stop`, `.alignment`, `.levelChange` (HIG Playing Haptics, https://developer.apple.com/design/human-interface-guidelines/playing-haptics; https://bleepingswift.com/blog/sensory-feedback-haptics-swiftui).

Fixed mapping (exhaustive — anything not listed gets **no** haptic):

| Event | Feedback |
|---|---|
| Message sent | `.impact(weight: .light)` |
| Agent run completed successfully | `.success` (once, on terminal stream event) |
| Agent run failed / stream error | `.error` |
| Destructive confirm (archive, discard changes, close chat) | `.warning` on the confirmation presentation, not the act |
| Stop button engaged | `.stop` |
| AskUserQuestion arrives (composer morphs) | `.impact(weight: .medium)` |
| Pull-to-refresh trigger, picker detents | `.selection` |

**Forbidden:** haptics per streamed token or per tool-call state change mid-run; haptics on scroll; haptics without a visible state change (HIG: haptics must accompany a clear cause; avoid during continuous streams). A multi-tool run produces exactly two haptics: send and completion.

### 3.3 Reduce Motion

- Read `@Environment(\.accessibilityReduceMotion)`; when true: replace movement transitions with `.opacity` crossfades, drop the send-bubble travel (S1), disable the status-strip pulse (S2), and pass `nil`/short `easeInOut` instead of springs (https://tanaschita.com/ios-accessibility-reduced-motion/; https://www.createwithswift.com/ensure-visual-accessibility-supporting-reduced-motion-preferences-in-swiftui/).
- System glass morphs and nav transitions adapt automatically; only custom motion needs gating.

### 3.4 Motion spec table

The complete custom-motion inventory for v1. Anything not in this table uses system-default transitions (navigation pushes, sheet presentations, list edits) untouched.

| Event | Animation | Notes |
|---|---|---|
| Send message (S1) | `.bouncy(duration: 0.35, extraBounce: 0.1)` | Only bouncy spring in the app |
| Tool row expand/collapse | `.snappy(duration: 0.2)` | Chevron rotates 90° in the same spring |
| Tool group collapse (summary bar) | `.smooth(duration: 0.3)` | |
| Run-completion fold-in (S4) | `.smooth(duration: 0.3)` | One grouped settle |
| Jump-to-now pill in/out (S5) | `.snappy(duration: 0.2)`, scale 0.9→1.0 + opacity | |
| Scroll-to-bottom (pill tap) | `.smooth(duration: 0.3)` | No animation under Reduce Motion |
| Composer ↔ question morph (S3) | System glass morph via `glassEffectID` | Chips stagger `.snappy(duration: 0.2)`, 40ms apart |
| Status-strip pulse (S2) | `easeInOut`, 0.8Hz, opacity 1.0↔0.4, `.repeatForever` | Static under Reduce Motion |
| Streaming caret blink | `easeInOut(duration: 0.6)`, `.repeatForever(autoreverses: true)` | Allowed under Reduce Motion (sub-1Hz opacity) |
| Shimmer placeholder | `TimelineView`-driven gradient sweep, 1.2s period | Static fill under Reduce Motion |
| Copy-button checkmark swap | `.snappy(duration: 0.2)`, symbol `contentTransition(.symbolEffect(.replace))` | Reverts after 1.5s |
| Skeleton → content | `.opacity` crossfade, 0.2s | Never slide |
| Streaming text append | **none** | P2: appends are instantaneous |

---

## 4. Best-in-class teardowns

*(This section is observational by nature; sources are published teardowns/reviews, not vendor specs. No Mobbin captures were available — see header.)*

### 4.1 ChatGPT iOS

- **What works:** radical subtraction — the empty state *is* the composer ("empty state as invitation"); streaming as progressive disclosure makes a 10s response feel fast because tokens appear in ~0.3s; the model selector hides complexity behind outcome labels; a fixed-measure response column keeps reading comfortable (https://www.925studios.co/blog/chatgpt-interface-design-breakdown). The composer consolidates tools behind one `+`/Tools menu, leaving a clean single field with dictation and voice at hand (https://www.bgr.com/tech/chatgpt-got-a-makeover-but-all-of-your-ai-tools-are-still-there/). OpenAI's own UI guidelines for in-ChatGPT apps state the shimmer convention: "the composer input 'shimmers' to show that a response is streaming" (https://developers.openai.com/apps-sdk/concepts/ui-guidelines).
- **Avoid:** its conversation management (flat history list, weak search/grouping) is widely criticized — our session inbox (repo-grouped, Active/Archive) is already stronger on web and must stay so on iOS.

### 4.2 Claude iOS

- **What works:** calm, low-chrome, reading-first presentation; messaging-app activation pattern (always-available bottom composer, no separate "prompt screen"); auto-scroll that breaks when the user scrolls up, with a jump-to-bottom control *(observational)*.
- **Avoid:** long responses with no per-section collapsing are hard to skim — our collapsible tool cards and tool-summary bar are the antidote; keep stop/regenerate controls visible during a run, not buried in overflow menus.

### 4.3 GitHub Mobile

- **What works:** the existence proof that **PR review on a phone is viable**: unified (not split) diffs, syntax highlighting, line-anchored comment composers that keep code context visible, a clear triage-vs-deep-dive split between bottom tabs and pushed stacks, cohesive checks/commits/comments integration *(observational; product page https://github.com/mobile)*. This is the direct template for our Diff/Changes/PR surfaces.
- **Avoid:** large multi-file PRs are tedious without per-file navigation aids (add a file-jump menu); dense comment threads develop sub-44pt tap targets — keep ours at 44pt.

### 4.4 Linear mobile

- **What works:** the strongest token discipline in B2B mobile — tight neutral palette with one accent, perceptually-even LCH-derived color ramps so light/dark variants keep equal vibrancy/contrast, dense lists that stay legible through spacing rhythm rather than boxes (teardown: https://getdesign.md/linear.app/design-md; LCH rationale: https://atmos.style/blog/lch-color-space). Mobile is deliberately scoped to triage + quick replies rather than recreating desktop.
- **Avoid:** icon-only minimalism hurts first-run discoverability; our v1 keeps text labels alongside glyphs in tab bar and tool rows.

### 4.5 Slack iOS

- **What works:** bottom tab scaffold with global **search moved to the thumb zone** in the iOS 26-era redesign (https://slack.com/blog/news/redesigning-slack-ios26 *(URL as returned by search; verify before citing in issues)*); the "new messages / jump to present" bar as the canonical break-follow pattern; serious VoiceOver/Dynamic Type engineering in the message pane (https://slack.engineering/ways-we-make-the-slack-ios-app-accessible/).
- **Avoid:** message-pane density creep (attachment cards + reactions + thread previews bloat every row) and a composer crowded with icons. Our composer holds exactly: text field, attach (`+`), mic, send/stop. Everything else lives behind `+` or in the toolbar.

### 4.6 Patterns to borrow / avoid (summary)

| Borrow | From | Avoid | From |
|---|---|---|---|
| Empty state = composer + suggestion chips | ChatGPT | Flat undifferentiated history | ChatGPT |
| Shimmering pending-response placeholder | ChatGPT | Hidden stop/regenerate controls | Claude |
| Break-follow + jump-to-present pill | Claude/Slack | One long uncollapsible response blob | Claude |
| Unified diff + line-anchored composer | GitHub Mobile | Split diffs on phone | (general) |
| One-accent token discipline, LCH ramps | Linear | Icon-only labels | Linear |
| Bottom-reachable search | Slack | Composer icon farm; row density creep | Slack |

### 4.7 What the teardowns imply for our navigation

- **Four tabs, labeled, in this order:** Sessions (`bubble.left.and.bubble.right`) · Repos (`folder`) · Agents (`sparkles`, background agents + runs) · Settings (`gearshape`). This is the GitHub Mobile "triage tabs + deep stacks" model, matching the route map in `docs/plans/ios-app/research/09-web-ux-inventory.md` §0; on iPadOS 26 `TabView` adapts to a sidebar representation automatically.
- **Search lives at the bottom** (Slack's thumb-zone lesson): use iOS 26's bottom-aligned `searchable` placement on the Sessions stack; `Cmd+K` opens the same switcher on iPad.
- **The session workspace is one screen with progressive depth**, not tabs-within-tabs: chat transcript is primary; the git panel (Files/Diff/Changes/PR — the web's right panel) is a trailing inspector on iPad regular width and a toolbar-presented full-height sheet on compact. Chat tabs within a session render as a compact top strip only when a session has >1 chat (web parity, STORY-034) — never show a one-tab strip.
- **The live-run status strip (S2) is the cross-tab connective tissue** — it is what lets a 4-tab structure feel like one app while an agent works: navigation anywhere, the running session always one tap away (the pattern Apple's Music mini-player established, now first-class via `TabViewBottomAccessory`).

---

## 5. Streaming-text rendering UX

This is the app's center of gravity. The stream is AI SDK v6 UI Message Chunks over SSE (see `docs/plans/ios-app/research/01-api-chat-and-streaming.md` and `22-swift-sse-and-stream-protocol.md`); chunks arrive at 20–100/sec and are coalesced to UI updates every 50–100ms per the architecture brief.

### 5.1 Pending and streaming indicators

- **Before first token:** a shimmering placeholder row (rounded rect, animated gradient via `TimelineView`) where the assistant message will appear — the ChatGPT-conventional "thinking" treatment. Replace with real content on first chunk via crossfade.
- **While streaming text:** a small block caret (a `Rectangle` ~2×17pt, `Color.accent`, opacity animating 1→0 `.repeatForever(autoreverses: true)`) rendered as an **overlay at the end of the last line, not as part of the text** — keeping it out of the `Text` content avoids fighting Markdown reflow. Remove on stream finish.
- **While reasoning/tool phases run:** no caret; the active tool row's spinner is the indicator (§5.5). Exactly one "alive" indicator on screen at a time.
- iOS 18+ `TextRenderer` enables per-glyph effects if we later want a subtle fade-in on appended runs (https://fatbobman.com/en/posts/creating-stunning-dynamic-text-effects-with-textrender/) — **not** in v1; restraint pillar applies.

### 5.2 Scroll anchoring

Exact behavior (the consensus pattern across ChatGPT/Claude/Slack, implemented with iOS 17/18 ScrollView APIs):

1. Transcript `ScrollView` uses `.defaultScrollAnchor(.bottom)` and `scrollPosition(id:)` bound to the last message id.
2. `followsLive: Bool` starts `true`. While `true`, every coalesced content update keeps the view pinned to bottom (no animated scroll per token — position is maintained, not re-scrolled).
3. Any user upward drag sets `followsLive = false` (detect via `.onScrollGeometryChange` on iOS 18+: user offset moves away from bottom edge beyond a 24pt threshold).
4. When `followsLive == false` and streaming continues, show the **jump-to-now pill** (§10 S5) floating above the composer. Tapping it scrolls to bottom with `.smooth(duration: 0.3)` and re-arms following.
5. Stream completion while unfollowed: pill morphs its label from "Live" to "1 new message"; it never force-scrolls.
6. **No layout jumps:** earlier rows must never resize during a stream. Only the in-flight message mutates (its model is the isolated `@Observable` streaming buffer from `20-swift-app-architecture.md` §3.3); completed rows are immutable value types with stable ids. Don't wrap row heights in animations during streaming.

(Reference implementation to study, not adopt: Stream Chat SwiftUI, https://github.com/GetStream/stream-chat-swift.)

### 5.3 Progressive Markdown

- **Never re-parse the whole transcript per token.** Completed messages are parsed once and cached as rendered blocks. Only the in-flight message re-parses, and only on the coalesced 50–100ms tick.
- Parse with a CommonMark/GFM parser (`apple/swift-markdown`, https://github.com/swiftlang/swift-markdown) into a block model `enum MessageBlock { paragraph, codeBlock, list, table, … }`; render blocks as separate SwiftUI views so a change in the tail doesn't relayout the head. (`MarkdownUI`, https://github.com/gonzalezreal/swift-markdown-ui, is the fallback if a custom block renderer is too costly, but it re-renders whole documents — measure first.)
- **Half-open code fences:** when the tail contains an unclosed ``` fence, render a code-block shell immediately (language label from the fence info string, copy button disabled, monospaced plain text inside, no highlighting). Apply syntax highlighting only when the fence closes or the message ends (end-of-message = implicit close). This is the standard tolerant-renderer behavior in AI clients.

### 5.4 Code blocks

- Container: opaque `CodeBackground` token (§11.1), 8pt corner radius, header strip with language label (`caption`, `.secondary`) left and a 44pt copy button right (haptic-free; shows a transient "Copied" checkmark swap).
- Body: `Font.system(.callout, design: .monospaced)`, **horizontal scroll, no wrap** (preserves indentation; matches GitHub Mobile and developer expectation). A per-user "wrap lines" toggle may come later; default is scroll.
- Syntax highlighting: **Highlightr** (https://github.com/raspu/Highlightr) for broad language coverage in v1 (run it off-main on the `@concurrent` parsing path; cache attributed strings per block). `Splash` (https://github.com/JohnSundell/Splash) is Swift-only — insufficient alone. Tree-sitter via `SwiftTreeSitter`/`Neon` (https://github.com/ChimeHQ/SwiftTreeSitter, https://github.com/ChimeHQ/Neon) is the post-v1 upgrade path if Highlightr's JS-core cost shows up in profiles. Highlight themes must be our own two (light/dark) tied to the §11.1 tokens, not a stock highlight.js theme.
- Long blocks (>40 lines) render collapsed to ~14 lines with an "Expand · N lines" footer.

### 5.5 Tool-call disclosure rows

Mirror of the web's loved tool cards, adapted to compact width:

- Model: `status ∈ {pending, running, success, error}`, `kind ∈ {read, edit, write, shell, fetch, task, composio}`, title (e.g., file path or command), optional output payload.
- **Running:** compact row — SF Symbol for the kind, title in `callout`, trailing spinner. **Done:** spinner becomes checkmark (`StatusSuccess` color) or x-mark (`StatusError`); row gains a disclosure chevron.
- Tap expands with `.snappy(duration: 0.2)` to show output (stdout in a mini code block, edit summaries as ±line counts). Collapsed by default after success; **errors auto-expand**.
- Consecutive tool calls group under a header row ("Ran 6 tools · 4 edits · 2 reads" — the web's tool-summary bar, STORY-039) which collapses the whole group; this is what makes 50-tool runs skimmable on a phone.
- Status is conveyed by **icon + label + color**, never color alone (§7.4).

### 5.6 Diffs

- **Unified only on iPhone** (split optional later on iPad regular width). Monospaced, fixed-width gutter with `+`/`-` glyphs, line backgrounds `DiffAddedBg`/`DiffRemovedBg` (§11.1), intraline changed-token spans in stronger variants of the same hues.
- Structured model (`DiffHunk` → `DiffLine(type:text:)`), not colored raw text — required for VoiceOver labels ("Added line: …", §7.5) and intraline spans.
- Per-file sections with sticky headers and a file-jump menu (GitHub Mobile's gap, our improvement). Diff data comes from `GET /api/sessions/[id]/diff` (see `02-api-sessions-sandbox-git.md`).

### 5.7 Composer specification

The composer synthesizes the teardown findings (ChatGPT's consolidation, Claude's minimalism, Slack's cautionary icon farm) into one exact anatomy:

- **Idle anatomy, left → right:** `plus` attach button (44pt) · multiline text field (placeholder "Message the agent…") · `mic` dictation button (44pt) · send button (`arrow.up.circle.fill`, 44pt, `AccentPrimary`, disabled at 40% opacity when input is empty *and* no attachments — attachments alone enable send, matching web STORY-032). The whole cluster sits in the single glass container from §11.4.
- **Text field behavior:** grows from 1 to a maximum of 6 visible lines, then scrolls internally; `Enter` inserts a newline on hardware keyboards (`Cmd+Enter` sends, §6.3); on-screen keyboard send uses the send button only. Draft text persists per chat across app launches (GRDB-backed; matches the web's draft snapshots).
- **Streaming state:** send button swaps to stop (`stop.fill` on the tinted glass capsule from §11.4) with `contentTransition(.symbolEffect(.replace))`; text field stays enabled so users can compose the next message during a run (queued-send is a product decision for the plan; the *UI* must not lock).
- **Attachment chips:** images and long-paste `.txt` conversions render as 56pt-high chips in a horizontal row above the text field, each with a 22pt `xmark.circle.fill` remove button hit-padded to 44pt. The chip row is part of the same glass container (no second glass surface — P1/G2).
- **Voice:** the `mic` button drives server transcription via `POST /api/transcribe` (web STORY-033) — `.start`/`.stop` sensory feedback on begin/end of recording, live waveform bars in `AccentPrimary` inside the text field area, transcribed text inserted at the caret, never auto-sent.
- **`+` menu contents (v1):** Photo library · Take photo · Paste as file. Nothing else; model picker and tool toggles live in the chat toolbar, not the composer (anti-Slack rule).
- **AskUserQuestion state:** §10 S3 replaces the entire anatomy with the question card; the draft (if any) is preserved and restored after the answer.
- **Safe areas:** the composer respects the home indicator via standard safe-area insets and lifts with the keyboard using the system keyboard layout guide — no manual offsets (manual keyboard math is the #1 source of composer jank in chat apps).

---

## 6. iPad

### 6.1 Layout

- **`NavigationSplitView` (two columns)**: sidebar = session inbox (repo-grouped, Active/Archive), detail = chat workspace. Three columns are unjustified — the git panel becomes an inspector/trailing pane inside the detail view, not a nav column. Style `.balanced`; `columnVisibility` bound to state (https://developer.apple.com/documentation/swiftui/navigationsplitview).
- It collapses automatically to a stack at compact width — which on **iPadOS 26 happens constantly**, because resizable free-form windows are the default multitasking model (Stage-Manager-only is gone; users drag any edge; a menu bar drops from the top edge) (https://appleinsider.com/inside/ipados-26/tips/whats-new-with-ipad-app-windows-in-ipados-26-and-how-they-work). **Design rule: branch on `horizontalSizeClass`, never on device idiom.** Every screen must remain functional at iPhone-width windows on iPad.
- Define menu-bar commands with the SwiftUI `Commands` API so the iPad menu bar and the Cmd-HUD populate from one declaration.

### 6.2 Pointer and hover

- All tappable rows/buttons get `.hoverEffect(.automatic)`; `.highlight` for list rows, `.lift` for floating glass buttons. Use `onHover` only for *additive* affordances (reveal row quick-actions like the web sidebar's hover Plus/GitBranch buttons — which must remain always-visible at touch, matching the web's mobile behavior noted in `09-web-ux-inventory.md` A2).

### 6.3 Hardware keyboard shortcuts (v1 set)

| Shortcut | Action |
|---|---|
| `Cmd+N` | New session dialog |
| `Cmd+Enter` | Send message (`Enter` inserts newline in the multiline composer) |
| `Cmd+K` | Session/command switcher |
| `Cmd+1…4` | Switch top-level tabs |
| `Cmd+F` | Find in transcript |
| `Cmd+.` | Stop streaming run |
| `Cmd+Shift+]` / `[` | Next/previous chat tab within a session |

Declared via `.keyboardShortcut` on visible controls (so the hold-Cmd discoverability HUD lists them) plus `Commands` groups for the menu bar.

### 6.4 Window-size test matrix

Because iPadOS 26 windows are freely resizable with app-dependent minimums (AppleInsider, §6.1), the design must be verified at concrete sizes rather than "iPad portrait/landscape". Minimum matrix for design QA and snapshot tests (points, width × height):

| Configuration | Size | Expected layout |
|---|---|---|
| iPhone 17 Pro portrait | 402 × 874 | Compact: tabs + stack |
| iPhone landscape | 874 × 402 | Compact height: composer must not be occluded by keyboard |
| iPad 13" full screen | 1032 × 1376 | Regular: split view, sidebar visible |
| iPad half Split View | ~507 × 1376 | Compact width: split collapses to stack |
| iPadOS 26 small floating window | ~400 × 600 | Compact: identical to iPhone layout, no clipping |
| iPadOS 26 wide short window | ~900 × 500 | Regular width + short height: transcript stays usable, composer 1-line default |

Rule: if a layout decision needs a number, it keys off `horizontalSizeClass` (and `dynamicTypeSize`), not these literal pixel values — the matrix exists to *test* the breakpoints, not to encode them.

---

## 7. Accessibility as design

### 7.1 VoiceOver for a streaming transcript

- **Never announce per token.** While streaming, expose a single status element ("Assistant is responding") carrying `.accessibilityAddTraits(.updatesFrequently)`; VoiceOver then re-reads it only when focused (WWDC23 "Build accessible apps with SwiftUI and UIKit", https://developer.apple.com/videos/play/wwdc2023/10036/).
- On stream completion, post **one** announcement via `AccessibilityNotification.Announcement` ("Agent finished: 4 files edited, 2 commands run") (https://developer.apple.com/documentation/accessibility/accessibilitynotification/announcement). Long responses are *not* auto-read; the user navigates to them.
- Each message row is one element: `.accessibilityElement(children: .combine)` with label "Assistant said, …" / "You said, …" plus timestamp. Copy/retry/fork are `accessibilityAction(named:)` custom actions, not tiny buttons in the swipe order (https://swiftwithmajid.com/2021/04/15/accessibility-actions-in-swiftui/).
- Tool rows: label = "Tool: Edit, apps/web/lib/foo.ts, succeeded"; expanded output exposed via `accessibilityCustomContent` so it's on-demand, not read up front (WWDC21 "Tailor the VoiceOver experience in your data-rich apps", https://developer.apple.com/videos/play/wwdc2021/10116/).

### 7.2 Dynamic Type without breakage

- `@ScaledMetric(relativeTo:)` for every non-text dimension that should breathe (bubble padding, icon sizes, code-block header height).
- Composer and message-action rows switch `HStack`→`VStack` at accessibility sizes via `ViewThatFits` or `AnyLayout` keyed on `dynamicTypeSize.isAccessibilitySize` (WWDC24 "Catch up on accessibility in SwiftUI", https://developer.apple.com/videos/play/wwdc2024/10073/).
- No fixed heights on any text-bearing view; no `lineLimit(1)` on message previews beyond the inbox (inbox previews use `lineLimit(2)` and may truncate). Code blocks are exempt from Dynamic Type *scaling beyond XL* but never clip vertically.
- CI: snapshot tests render key screens at `.large`, `.xxxLarge`, and `.accessibility3` (see `24-ios-testing-and-ci.md`).

### 7.3 Reduce Transparency / Reduce Motion fallbacks for glass

- System glass adapts automatically (§1.2 G8). For any custom material use, read `@Environment(\.accessibilityReduceTransparency)` and substitute opaque `secondarySystemBackground` + a hairline border.
- Custom motion is gated per §3.3. The streaming caret blink is allowed under Reduce Motion (it's a sub-1Hz opacity change), but the shimmer placeholder becomes a static fill.

### 7.4 Differentiate Without Color

- Tool/run status = symbol + text + color, never color alone (checkmark/x-mark/spinner glyphs carry the meaning). Diff lines carry `+`/`-` gutter glyphs, not only backgrounds. Honor `@Environment(\.accessibilityDifferentiateWithoutColor)` by thickening the non-color cues (e.g., add "Added"/"Removed" badges per hunk).

### 7.5 Code and diffs under VoiceOver

- Code block element label: "Swift code block, 24 lines"; content via `accessibilityValue`/custom content; custom actions "Copy code".
- Diff line labels: "Added line: …" / "Removed line: …"; hunk label "Diff in session-chat-content.tsx, 4 changed lines"; actions "Copy patch".

---

## 8. Onboarding and empty states

- **HIG onboarding rules:** get people to content fast; no up-front tutorial carousels; request permissions in context (notifications: ask only when the user starts their first agent run, framed as "get told when it finishes"); avoid gratuitous sign-in walls (https://developer.apple.com/design/human-interface-guidelines/onboarding). Our wall is unavoidable (the product is account-bound) — so it is **one** screen: product name, one sentence, Sign in with Apple + Continue with Vercel buttons, nothing else. GitHub connect happens after, mirroring the web's two-step `/get-started` (see `06-auth-for-native-clients.md`).
- **Empty states are designed surfaces, not gaps.** Every top-level screen ships with one: what this screen will show, one primary CTA, at most one SF-Symbol-scale illustration (no mascot art). Sessions empty state = the **ChatGPT pattern**: a focused composer with 3 suggestion chips ("Fix a failing test in …", "Explain this repo", "Start from a GitHub issue") — the blank screen *is* the invitation (https://www.925studios.co/blog/chatgpt-interface-design-breakdown).
- **Progressive disclosure** for power surfaces (background agents, runtime profiles, Composio): the v1 visible path is the simple one; advanced options live behind explicit "Advanced" disclosure groups (https://www.nngroup.com/articles/progressive-disclosure/).
- **Skeletons vs spinners:** lists with known structure (session inbox, repo lists, settings) load with `redacted(reason: .placeholder)` skeletons; spinners only for genuinely indeterminate sub-second waits (e.g., PR readiness check). The pending-response shimmer (§5.1) is the chat-specific skeleton.

### 8.1 First-run storyboard (exact sequence)

1. **Welcome (1 screen):** app glyph, "Your coding agents, anywhere.", Sign in with Apple + Continue with Vercel. No carousel, no skip-able pages.
2. **Auth handoff:** `ASWebAuthenticationSession` flow per `23-ios-auth-patterns.md`; a full-screen progress state with the app glyph (not a blank web view) while tokens exchange.
3. **GitHub connect (conditional):** mirrors web `/get-started?step=github` — one screen explaining why (repo access for sessions), one CTA, and an explicit "Not now" that lands in the no-repo "New Chat" mode (the web's sandbox-free chat, STORY-013), so the app is usable before GitHub is connected.
4. **Sessions empty state:** the blank-composer invitation (§8) with three suggestion chips. **No permission prompts have appeared yet.**
5. **First run started:** after the user's first send, a single inline card under the status strip offers notifications: "Want a ping when the agent finishes?" → only then trigger the system notification prompt. Decline collapses the card permanently (re-offerable from Settings).
6. **First completion:** S4 Landing plays; if the run produced a diff, the "View diff" chip doubles as the discovery moment for the git surface — no tooltip tour needed.

Every step must survive process death and resume where it left off (auth state machine per `23-ios-auth-patterns.md`).

---

## 9. Proposal: design pillars

Six named pillars. Each rule is mechanical on purpose — a weak model should be able to check a diff against them.

### P1 — Content opaque, chrome glass

> Glass marks what floats; opacity marks what matters.

- **Do:** apply glass only to surfaces listed in the §11.4 glass map; use system bars/tab bars untouched; group adjacent custom glass in one `GlassEffectContainer`.
- **Don't:** add `.glassEffect` to message bubbles, tool rows, code blocks, cards, or list cells; never set custom backgrounds on toolbars; never use `.ultraThinMaterial` as fake glass; never layer glass over glass.

### P2 — The stream is sacred

> Nothing may interrupt, jitter, or decorate streaming output.

- **Do:** mutate only the in-flight message; coalesce UI updates at 50–100ms; keep one alive-indicator on screen; preserve pin-to-bottom per §5.2.
- **Don't:** animate text appends; trigger haptics per token or per tool transition; auto-scroll when the user has scrolled up; let earlier rows change height mid-stream; show more than one spinner at once.

### P3 — One hand on iPhone, two modes on iPad

> Every primary action is reachable with a thumb; every screen works at any window size.

- **Do:** keep composer, send/stop, jump-pill, and search in the bottom half; branch layouts on `horizontalSizeClass` only; provide the full §6.3 shortcut set.
- **Don't:** put primary actions only in the top toolbar; check `UIDevice` idiom; design fixed-width iPad layouts that break in narrow windows.

### P4 — The system is the design system

> When Apple ships a component, we use it; we spend novelty only at signature moments.

- **Do:** text styles only (no point sizes outside tokens); semantic colors + the §11.1 token set only; SF Symbols only; standard `List`/`Form`/`NavigationSplitView` for settings and inbox.
- **Don't:** custom fonts; hex literals in views; custom icon art; custom nav/tab implementations; restyle standard controls beyond `.tint`.

### P5 — Status is always honest

> Every async operation shows pending → running → success/error, with the same vocabulary everywhere.

- **Do:** use the §5.5 status model for tool calls, sandbox status, PR checks, background runs; auto-expand errors; pair every status color with a glyph and a word; show stream-resume state truthfully after backgrounding (the web's honest elapsed-timer lesson, `09-web-ux-inventory.md` STORY-029).
- **Don't:** spinners without label; optimistic success states; silently swallowed failures; "Loading…" for states we can name precisely.

### P6 — Restraint is the brand

> One accent, two haptics per run, zero decoration.

- **Do:** stick to the §3.2 haptics table and §3.1 spring presets; default `bounce 0`; one accent color used for interaction only.
- **Don't:** introduce gradients, confetti, mascots, or custom celebratory animations; add haptics or sounds outside the table; use the accent for static decoration.

---

## 10. Proposal: signature interactions

Five named moments of delight. Each specifies trigger → behavior → motion → haptic → Reduce Motion fallback so it can be implemented verbatim.

### S1 — "Liftoff" (send)

- **Trigger:** user taps send (or `Cmd+Enter`).
- **Behavior:** composer text becomes the user bubble; the bubble departs from the composer's exact frame and settles into its transcript position (`matchedGeometryEffect` between composer text and bubble); composer clears and refocuses; shimmer placeholder (§5.1) appears beneath.
- **Motion:** `.bouncy(duration: 0.35, extraBounce: 0.1)` — the app's only bouncy spring. **Haptic:** `.impact(weight: .light)`. **Reduce Motion:** crossfade bubble in place; no travel.

### S2 — "Heartbeat" (live-run status strip)

- **Trigger:** any chat in any session is streaming while the user is elsewhere in the app.
- **Behavior:** a persistent `TabViewBottomAccessory` strip above the tab bar: leading 6pt dot in `StatusRunning`, label "{session title} · running · 0:42" with `.monospacedDigit()` timer; tapping deep-links to that chat with following armed. On completion the dot/glyph swaps to success/error and the strip auto-dismisses after 4s if not tapped.
- **Motion:** dot opacity pulse 1.0→0.4 at 0.8Hz `easeInOut`. **Haptic:** none (the chat surface owns completion haptics). **Reduce Motion:** static dot.

### S3 — "Morph" (AskUserQuestion composer)

- **Trigger:** stream emits an AskUserQuestion tool call (the web's composer-morph, STORY-037 — the #1 mobile moment per `09-web-ux-inventory.md`).
- **Behavior:** the glass composer morphs into the question card — question text + option chips (or free-text field) — via `glassEffectID` shape morph inside the composer's `GlassEffectContainer`; answering morphs it back and the run auto-continues.
- **Motion:** system glass morph; chips stagger in with `.snappy(duration: 0.2)` 40ms apart. **Haptic:** `.impact(weight: .medium)` on arrival. **Reduce Motion:** crossfade swap, no stagger.

### S4 — "Landing" (run completion)

- **Trigger:** terminal stream chunk (finish or error).
- **Behavior:** caret disappears; the tool-summary header (§5.5) folds in beneath the response ("Ran 6 tools · 4 edits · +120 −31"); cost/duration badges fade in on the message footer; if a PR/commit resulted, an action chip ("View diff", "Open PR") appears in the same fold.
- **Motion:** one `.smooth(duration: 0.3)` group fold-in — a single settle, not a sequence. **Haptic:** `.success` or `.error`, exactly once. **Reduce Motion:** elements fade in with no fold.

### S5 — "Jump to now" (break-follow pill)

- **Trigger:** user scrolls up ≥24pt during streaming (§5.2 step 3).
- **Behavior:** capsule pill floats above the composer: `chevron.down` + "Live" (streaming) or "N new" (after completion). Tap → smooth scroll to bottom, re-arm following, pill dissolves into the scroll (glass morph toward screen bottom edge).
- **Motion:** pill appears `.snappy(duration: 0.2)` scale 0.9→1.0; scroll `.smooth(duration: 0.3)`. **Haptic:** none. **Reduce Motion:** pill fades; scroll without animation.

### Anti-delight list (deliberate exclusions)

To keep S1–S5 special, the following are explicitly **not** built, and reviewers should reject them if they appear: confetti or particle effects on PR merge; typewriter sound effects; per-token text animation; animated mascots or empty-state illustrations beyond SF-Symbol scale; haptic "textures" during scrolling; parallax backgrounds; rainbow/gradient borders on streaming elements (the shimmering-border trend); splash-screen animations beyond the static launch screen. Each is a known pattern in 2025–26 AI apps and each violates P2 or P6.

---

## 11. Proposal: visual identity direction

### 11.1 Color system

Neutrals, text, separators, and surfaces are **system semantic colors, full stop** (§2.3). The custom palette is exactly twelve asset-catalog color sets in the design-system package (proposed: `ios/Packages/OpenAgentsDesignSystem/Sources/OpenAgentsDesignSystem/Resources/Colors.xcassets`); each must pass §2.4 contrast checks against its documented background in both modes:

| Token | Light | Dark | Use |
|---|---|---|---|
| `AccentPrimary` | `#5856D6` (systemIndigo) | `#5E5CE6` | Tint: links, send button, selected states, caret |
| `StatusRunning` | `#007AFF` | `#0A84FF` | Spinners, running dots, live strip |
| `StatusSuccess` | `#34C759` | `#30D158` | Checkmarks, success badges |
| `StatusWarning` | `#FF9500` | `#FF9F0A` | Degraded sandbox, expiring auth |
| `StatusError` | `#FF3B30` | `#FF453A` | Failures, stop button, destructive |
| `CodeBackground` | `#F6F6F8` | `#1C1C1E` | Code blocks, stdout, diff base |
| `CodeBorder` | `#E3E3E8` | `#3A3A3C` | 0.5pt code/diff container hairline |
| `DiffAddedBg` | `#E6F4EA` | `#0F2E1A` | Added-line background |
| `DiffRemovedBg` | `#FCEBEA` | `#3A1212` | Removed-line background |
| `DiffAddedAccent` | `#1A7F37` | `#3FB950` | `+` gutter glyphs, intraline added spans |
| `DiffRemovedAccent` | `#CF222E` | `#F85149` | `-` gutter glyphs, intraline removed spans |
| `BubbleUser` | `#ECECF4` | `#2C2C2E` | User message bubble fill (assistant messages have **no** bubble — full-width text on background, ChatGPT/Claude reading pattern) |

Status colors are the iOS system palette values on purpose (P4); the accent is system indigo — distinct from default blue, native-adaptive, and evocative without inventing a brand hue. Diff values follow GitHub's proven light/dark diff hues. *(Exact diff/dark values are a starting proposal; tune against contrast tests during implementation, keeping the token names fixed.)*

### 11.2 Type scale

The mapping table in §2.2 **is** the type spec; restated as tokens:

| Token | Definition |
|---|---|
| `Type.screenTitle` | `.largeTitle` (navigation large titles only) |
| `Type.sessionTitle` | `.headline` |
| `Type.message` | `.body` |
| `Type.toolRow` | `.callout` |
| `Type.code` | `Font.system(.callout, design: .monospaced)` |
| `Type.metadata` | `.subheadline`, `.secondary` |
| `Type.timestamp` | `.footnote`, `.secondary` |
| `Type.badge` | `.caption`; cost/duration: `.caption2.monospacedDigit()` |

No other font expressions are permitted in feature code.

### 11.3 Iconography (SF Symbols policy)

- **SF Symbols only.** No custom vector icons in v1; the app icon (layered Icon Composer artwork) is the sole custom drawing.
- Rendering: monochrome by default; `.hierarchical` for multi-part glyphs; palette/multicolor **only** for status glyphs colored via §11.1 tokens. Weight matches adjacent text (`.regular` default); fills indicate selection (`bubble.left` → `bubble.left.fill`).
- Fixed vocabulary (extend only via design review): sessions `bubble.left.and.bubble.right`, repos `folder`, agents/background `sparkles`, settings `gearshape`, tool-read `doc.text`, tool-edit `pencil`, tool-write `doc.badge.plus`, tool-shell `terminal`, tool-fetch `globe`, commit `arrow.triangle.branch` *(verify name in the SF Symbols app; fallback `arrow.branch`)*, PR `arrow.triangle.pull`, diff `plus.forwardslash.minus`, run-success `checkmark.circle.fill`, run-error `xmark.circle.fill`, stop `stop.fill`, send `arrow.up.circle.fill`, mic `mic`, attach `plus`, jump-to-now `chevron.down`.

### 11.4 Glass-usage map

| Surface | Treatment |
|---|---|
| Tab bar, navigation/toolbars, sheets' chrome, alerts, context menus | **System glass — automatic; do not touch** |
| Composer container (text field + attach + mic + send cluster) | **Custom glass**: one `GlassEffectContainer`, `.glassEffect(.regular, in: .rect(cornerRadius: 24))`; morph host for S3 |
| Live-run status strip (`TabViewBottomAccessory`) | **Glass** (system accessory styling) |
| Jump-to-now pill, floating "scroll to top" affordances | **Glass capsule**, `.interactive()` |
| Stop button during a run | **Glass capsule with `StatusError` tint** — the app's only tinted glass |
| Transcript background, message text, user bubbles | **Opaque** (`systemBackground` / `BubbleUser`) |
| Tool-call rows, tool-summary bar | **Opaque** (`secondarySystemBackground`) |
| Code blocks, stdout, diffs | **Opaque** (`CodeBackground`) — readability is non-negotiable |
| Session inbox rows, repo dashboards, settings forms, onboarding | **Opaque** (system grouped backgrounds) |
| Empty-state suggestion chips | **Opaque** `secondarySystemBackground` capsules (they sit in the content layer) |

Rule of thumb encoded by the map: glass appears only on things that float **over** the transcript; anything you read is opaque.

### 11.5 Metrics tokens (spacing, radii, component minimums)

| Token | Value | Use |
|---|---|---|
| `OASpacing.xs/sm/md/lg/xl` | 4 / 8 / 12 / 16 / 24 | The only spacing values in feature code (§2.6) |
| `OARadius.chip` | 8 | Attachment chips, suggestion chips, badges |
| `OARadius.block` | 8 | Code blocks, diff containers |
| `OARadius.card` | 12 | Tool rows, status cards, empty-state cards |
| `OARadius.bubble` | 18 | User message bubbles (continuous corner style) |
| `OARadius.composer` | 24 | Composer glass container |
| `MinHit` | 44 × 44 | Every tappable; enforced via padded `.contentShape` |
| Hairline | 0.5 | All borders (`CodeBorder`, `separator`) |
| Transcript measure | ≤ 672pt | Max text-column width on iPad regular width (the ChatGPT fixed-measure lesson, §4.1); transcript centers beyond it |
| Tool row min height | 44 | Collapsed state |
| Status strip height | 48 | S2 accessory |

All radius values use `RoundedRectangle(cornerRadius:style: .continuous)`. These metrics live beside the color/type tokens in the DesignSystem package and are the only magic numbers permitted to exist.

### 11.6 The feel, in one paragraph

Open-agents on iOS should feel like a **calm instrument panel**: a quiet, mostly-monochrome reading surface where the only saturated pixels are the accent on interactive elements and the status colors telling the truth about running work; glass chrome floating lightly over it; motion that only ever confirms what the user or the agent just did; and exactly two heartbeats per run — one when you send, one when it lands. The pleasure comes from trust and pace, not ornament: the app never moves unless something real moved.

---

## 12. Implications for the plan

1. **Ship a DesignSystem package before any feature UI.** Proposed `ios/Packages/OpenAgentsDesignSystem` containing: the twelve color sets (§11.1), type tokens (§11.2), spacing constants (4/8/12/16/24), the symbol vocabulary (§11.3) as a `ToolKind`→symbol map, status model + status glyph view (§5.5), and the haptics table (§3.2) as a single `Haptics` enum. Feature issues then reference tokens by name; a weak model never invents a color or font.
2. **The pillars become PR checklist lines.** Add the P1–P6 don't-lists to the iOS PR template (e.g., "no `.glassEffect` outside the §11.4 map", "no hex literals outside Colors.xcassets", "no haptics outside the table"). These are grep-able rules.
3. **The streaming transcript is one self-contained epic** with §5 as its acceptance spec: scroll-anchoring behaviors (5.2 steps 1–6), tolerant Markdown (5.3), code blocks (5.4), tool rows (5.5), and S1/S4/S5 signature moments. It depends on the chunk-coalescing stream layer from `22-swift-sse-and-stream-protocol.md` and the state isolation from `20-swift-app-architecture.md` §3.3.
4. **Snapshot tests carry the design system.** swift-snapshot-testing 1.18.x records: every DesignSystem component in light/dark; chat screen at `.large`/`.xxxLarge`/`.accessibility3` Dynamic Type; tool rows in all four statuses; diff renderer light/dark; plus a unit test computing WCAG contrast for every §11.1 token against its documented background.
5. **Accessibility behaviors are acceptance criteria, not polish**: the single completion announcement, combined message rows with custom actions, `updatesFrequently` status element, opaque fallbacks, and Differentiate Without Color handling (§7) belong in the chat epic's definition of done — they are cheap at build time and expensive to retrofit.
6. **Signature interactions are individually schedulable issues** (S1–S5), each with motion/haptic/fallback specs precise enough for a weak model. S2 (Heartbeat) depends on multi-session run state from the sessions API; S3 (Morph) depends on AskUserQuestion chunk handling in the stream layer — sequence them after those land.
7. **iPad costs are bounded if rules are followed from day one:** size-class-only branching, `NavigationSplitView` root, the §6.3 shortcut table, and `.hoverEffect` on tappables. Budget explicit QA passes for narrow iPadOS 26 windows (compact width on iPad) per `24-ios-testing-and-ci.md`.
8. **Dependencies introduced by this brief** (pin in the relevant issues): `apple/swift-markdown` (parsing), `raspu/Highlightr` (v1 highlighting; revisit with tree-sitter post-v1), and study-only references (Stream Chat SwiftUI, MarkdownUI). No TCA, no SwiftData, no design-side conflicts with the canonical stack.
9. **Open verification items for implementers:** exact SF Symbol names against the SF Symbols 7 app (§11.3); the Slack redesign URL (§4.5); final diff token values after contrast testing (§11.1); `TabViewBottomAccessory` API shape in Xcode 26 (verified to exist in `20-swift-app-architecture.md` §2.2, exact signature to confirm). WWDC 2026 lands this month — re-check Liquid Glass guidance deltas before the design-system issue starts.

---

## 13. Source list

**Apple primary:** HIG Materials (https://developer.apple.com/design/human-interface-guidelines/materials) · Adopting Liquid Glass (https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass) · WWDC25 323 "Build a SwiftUI app with the new design" (https://developer.apple.com/videos/play/wwdc2025/323/) · HIG Typography (https://developer.apple.com/design/human-interface-guidelines/typography) · HIG Color (https://developer.apple.com/design/human-interface-guidelines/color) · HIG Dark Mode (https://developer.apple.com/design/human-interface-guidelines/dark-mode) · HIG Layout (https://developer.apple.com/design/human-interface-guidelines/layout) · HIG Playing Haptics (https://developer.apple.com/design/human-interface-guidelines/playing-haptics) · HIG Onboarding (https://developer.apple.com/design/human-interface-guidelines/onboarding) · WWDC23 10158 "Animate with springs" (https://developer.apple.com/videos/play/wwdc2023/10158/) · WWDC23 10036 / WWDC24 10073 / WWDC21 10116 accessibility sessions · `NavigationSplitView` docs (https://developer.apple.com/documentation/swiftui/navigationsplitview) · AccessibilityNotification.Announcement (https://developer.apple.com/documentation/accessibility/accessibilitynotification/announcement) · Apple Fonts (https://developer.apple.com/fonts/).

**Community/secondary:** NN/g on Liquid Glass (https://www.nngroup.com/articles/liquid-glass/) · Donny Wals glassEffectUnion (https://www.donnywals.com/grouping-liquid-glass-components-using-glasseffectunion-on-ios-26/) · createwithswift glassEffectID + springs + reduced motion (https://www.createwithswift.com) · fatbobman TextRenderer (https://fatbobman.com/en/posts/creating-stunning-dynamic-text-effects-with-textrender/) · tanaschita Reduce Motion (https://tanaschita.com/ios-accessibility-reduced-motion/) · Swift with Majid accessibility actions (https://swiftwithmajid.com/2021/04/15/accessibility-actions-in-swiftui/) · CVS Health SwiftUI a11y techniques (https://github.com/cvs-health/ios-swiftui-accessibility-techniques) · 925studios ChatGPT breakdown (https://www.925studios.co/blog/chatgpt-interface-design-breakdown) · BGR ChatGPT composer (https://www.bgr.com/tech/chatgpt-got-a-makeover-but-all-of-your-ai-tools-are-still-there/) · OpenAI Apps SDK UI guidelines (https://developers.openai.com/apps-sdk/concepts/ui-guidelines) · DESIGN.md Linear teardown (https://getdesign.md/linear.app/design-md) · Atmos LCH (https://atmos.style/blog/lch-color-space) · Slack a11y engineering (https://slack.engineering/ways-we-make-the-slack-ios-app-accessible/) · Slack iOS redesign (https://slack.com/blog/news/redesigning-slack-ios26 — *verify URL*) · AppleInsider iPadOS 26 windowing (https://appleinsider.com/inside/ipados-26/tips/whats-new-with-ipad-app-windows-in-ipados-26-and-how-they-work) · Use Your Loaf size classes (https://useyourloaf.com/blog/size-classes/) · NN/g progressive disclosure (https://www.nngroup.com/articles/progressive-disclosure/) · WCAG G18 (https://www.w3.org/WAI/WCAG22/Techniques/general/G18) · GitHub Mobile (https://github.com/mobile) · Libraries: swift-markdown (https://github.com/swiftlang/swift-markdown), MarkdownUI (https://github.com/gonzalezreal/swift-markdown-ui), Highlightr (https://github.com/raspu/Highlightr), Splash (https://github.com/JohnSundell/Splash), SwiftTreeSitter (https://github.com/ChimeHQ/SwiftTreeSitter), Neon (https://github.com/ChimeHQ/Neon), Stream Chat SwiftUI (https://github.com/GetStream/stream-chat-swift).

**Uncertainties (explicit):** (1) competitor teardown details marked *(observational)* derive from reviews/walkthroughs, not Mobbin screenshot audits — Mobbin MCP was unavailable; (2) `regular` vs `clear` glass guidance is partly inferred from WWDC demos since the HIG prose is thin; (3) some exact dark-mode token values in §11.1 are proposals pending contrast testing; (4) a handful of SF Symbol names need verification in the SF Symbols app; (5) WWDC 2026 (this month) may revise Liquid Glass guidance — re-verify §1 before implementation begins.
