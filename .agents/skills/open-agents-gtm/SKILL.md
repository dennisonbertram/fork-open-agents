---
name: open-agents-gtm
description: Use when answering Open-Agents GTM questions, planning GTM work, routing account research, outbound, calls, activation, weekly review, or repo-native GTM status from evidence.
---

# Open-Agents GTM Adapter

This Open-Agents/Codex adapter uses the Claude project skill as the canonical
source:

- `.claude/skills/open-agents-gtm/SKILL.md`
- `.claude/skills/open-agents-gtm/references/gtm-epic-map.md`
- `.claude/skills/open-agents-gtm/references/approval-boundaries.md`
- `.claude/skills/open-agents-gtm/references/status-brief-template.md`

When this skill triggers, read the canonical Claude skill first, then follow its
GTM routing map, source-gap language, and approval boundaries. Preserve the same
guardrails for email, CRM, public GitHub issues, and durable GTM learning
persistence.
