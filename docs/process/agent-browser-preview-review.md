# Agent Browser Preview Review

Use this checklist when a PR has a Vercel Preview deployment and the change has
visible UI, user-facing status, settings, workflow output, or browser-visible
failure modes.

Agent Browser review is a smoke test. It does not replace deterministic unit,
route, workflow, or integration tests.

## When To Use It

Required by default for:

1. chat UI changes,
2. settings UI changes,
3. model/tool/runtime picker changes,
4. visible workflow or sandbox status changes,
5. landing or marketing page changes,
6. bug fixes that were found through a browser.

Optional for:

1. docs-only changes,
2. internal tests,
3. server-only refactors with no browser-visible behavior.

Use the shared dev environment instead of Preview for:

1. real Vercel or GitHub OAuth,
2. GitHub App installation callbacks,
3. repo-backed session creation,
4. sandbox startup,
5. live workflow runs,
6. live provider/inference calls,
7. migration proof.

## Basic Preview Review

```bash
agent-browser --session "pr-<number>" open "$PREVIEW_URL"
agent-browser snapshot -i
```

Exercise the changed path, then check the browser evidence:

```bash
agent-browser errors
agent-browser console
agent-browser network requests
```

Capture a screenshot when layout, copy, or visual state matters:

```bash
agent-browser screenshot "artifacts/pr-<number>-preview.png"
```

## Protected Preview Review

If Vercel Deployment Protection is enabled, do not paste the bypass secret in
the PR or chat. Load it from the environment and pass it as a header:

```bash
agent-browser \
  --session "pr-<number>" \
  --headers "{\"x-vercel-protection-bypass\":\"$VERCEL_AUTOMATION_BYPASS_SECRET\",\"x-vercel-set-bypass-cookie\":\"true\"}" \
  open "$PREVIEW_URL"
```

Then run the same snapshot, interaction, console, error, network, and screenshot
checks.

## Evidence To Record In The PR

Record:

1. Preview URL,
2. path exercised,
3. result of the changed interaction,
4. console/page errors summary,
5. network failures summary when behavior changed,
6. screenshot path or short visual note when relevant,
7. anything deferred to dev.

Example:

```markdown
Preview Agent Browser:
- URL: https://open-agents-git-example.vercel.app
- Path: Settings -> Models -> model picker
- Result: picker opened, search filtered results, selection persisted
- Console/errors: no page errors, no console errors
- Network: `/api/models` 200, preferences PATCH 200
- Deferred to dev: real Anthropic profile test
```

## Risk Tiers

- Low risk: docs, copy, isolated styles, static content.
  - Required proof: CI, Preview smoke, Agent Browser only if visual.
- Medium risk: settings, API route shape, non-critical state, additive schema.
  - Required proof: CI, targeted tests, Preview smoke, Agent Browser when
    browser-visible.
- High risk: auth, ownership, secrets, billing, inference, GitHub App, sandbox,
  workflows, migrations, destructive data changes.
  - Required proof: CI, Preview smoke, targeted tests, dev smoke, rollback
    notes.
