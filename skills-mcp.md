# Audit Scratchpad: Skills discovery/install & MCP servers

## Domain scope
- apps/web/lib/skills/*
- apps/web/lib/mcp/* (no skills-cache dir exists)
- apps/web/app/api/settings/skills/* and route.ts
- apps/web/app/api/settings/skills/generate/*
- apps/web/app/api/settings/mcp-servers/* and [serverId]/*
- apps/web/app/api/sessions/[sessionId]/skills/*

## Files read
(append as read)

## Key lessons-learned relevant to this domain
- "Skill discovery de-duplicates by first-seen name, so project skill directories must be scanned before user-level directories to allow project overrides." -> MUST verify the actual discovery code does project-first.
- FK constraint mock gap lesson (23503) relevant to MCP server store tests.
- mock.module first-win behavior relevant to skills/mcp tests.

## Candidate defects
(append as considered)

## Coverage gaps
(append at end)
