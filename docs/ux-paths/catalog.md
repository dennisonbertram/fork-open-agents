# UX Path Catalog: Open Agents

Generated: 2026-06-21
Total Stories: 18
Coverage: 12 / 12 recommended feature areas

## Summary

| Type | Count |
|------|-------|
| Short | 5 |
| Medium | 10 |
| Long | 3 |

## Coverage Matrix

| Feature Area | Stories | Gaps |
|-------------|---------|------|
| Public landing and auth | STORY-001, STORY-002 | Password reset is not a local product path; OAuth provider screens are external |
| Sessions and chat | STORY-003, STORY-004, STORY-005 | Long-running real model responses depend on available credentials |
| Repository sessions | STORY-006, STORY-007, STORY-008 | Merge flow depends on GitHub permissions and repo state |
| Sandbox recovery | STORY-009 | Real sandbox expiry timing is external |
| Models and inference | STORY-010, STORY-011 | Provider key validity is external |
| Composio tools | STORY-012 | External OAuth completion is outside the app |
| MCP servers | STORY-013 | Live MCP server validation needs a reachable test server |
| Skills | STORY-014 | Skill invocation in a real chat depends on agent runtime |
| Background agents | STORY-015 | Live dispatch depends on env readiness |
| Loops | STORY-016 | Feature may be disabled by env |
| Usage and leaderboard | STORY-017 | Interesting data requires prior usage |
| Sharing/public views | STORY-018 | Share target requires an existing chat/share id |

## Story Dependency Graph

```text
STORY-001 Public Landing
└── STORY-002 Authenticated Settings Navigation
    ├── STORY-003 Sessions Index
    │   ├── STORY-004 New Session Dialog
    │   └── STORY-005 Existing Chat Controls
    ├── STORY-010 Model Preferences
    ├── STORY-012 Composio Settings
    ├── STORY-013 MCP Settings
    ├── STORY-014 Skills Settings
    ├── STORY-015 Background Agents
    ├── STORY-016 Loops
    └── STORY-017 Usage And Leaderboard
```

## Stories

### STORY-001: Public Visitor Understands The Product And Starts Sign-In

**Type**: short
**Topic**: Public landing and auth
**Persona**: New visitor
**Goal**: Understand what Open Agents does and find the sign-in path.
**Preconditions**: User is signed out in a fresh browser.

#### Steps

1. Navigate to `/` -> The public landing page loads with the “Open Agents.” hero.
2. Scan the first viewport -> “Sign in with Vercel” is visible and primary.
3. Activate the theme controls -> The page remains usable in light and dark modes.
4. Click “Sign in with Vercel” -> The user is taken into the Vercel OAuth flow or an app-owned auth redirect.

#### Variations

- Navigate directly to `/sessions` while signed out -> The user sees a clear sign-in route instead of a broken private shell.

#### Edge Cases

- OAuth redirect fails -> The error should be user-readable and should not expose stack traces.

### STORY-002: Authenticated User Moves Through Settings Sections

**Type**: medium
**Topic**: Settings and navigation
**Persona**: Returning developer
**Goal**: Confirm settings are discoverable from the signed-in workspace.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/settings/profile` -> Profile settings load.
2. Click Preferences -> Preferences load without losing the settings rail.
3. Click Connections -> Vercel and GitHub connection cards load.
4. Click Models -> Model preferences and inference profiles load.
5. Click MCP servers -> MCP server configuration loads.
6. Click Usage -> Usage insights load or show a helpful empty/error state.

#### Variations

- User is not an admin -> Admin nav is hidden.
- User is an admin -> Admin nav appears and token revocation controls are clearly dangerous.

#### Edge Cases

- An API request fails -> The page shows a retryable message rather than an empty blank state.

### STORY-003: User Reviews The Sessions Index

**Type**: medium
**Topic**: Sessions and sidebar
**Persona**: Regular developer
**Goal**: Find existing sessions and start new work.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/sessions` -> The sessions shell loads.
2. Inspect the sidebar -> Existing sessions are grouped by status or repository.
3. Search or scan for a recent session -> The current session item is readable and selectable.
4. Open the new-session affordance -> A dialog or starter flow opens.
5. Cancel the flow -> The sessions page returns to its prior state.

#### Variations

- No sessions exist -> A helpful empty state appears with a clear next action.
- Archived sessions are visible -> Archive state is clear and reversible.

#### Edge Cases

- Archived session fetch fails -> “Retry” appears near the failure.

### STORY-004: User Starts A New Session From The Starter

**Type**: long
**Topic**: Session creation
**Persona**: Impatient developer
**Goal**: Create a session with the least friction.
**Preconditions**: User is signed in and has GitHub access configured if choosing a repo.

#### Steps

1. Navigate to `/sessions`.
2. Click “New session” or the plus affordance -> Session starter opens.
3. Choose no repository or a visible repository.
4. If a repo is chosen, choose an existing branch.
5. Review any Vercel project sync section.
6. Start the session -> The user lands in a chat view.
7. Confirm startup status is visible immediately.
8. Confirm the sandbox begins preparing without waiting for the first user message.

#### Variations

- Create from direct `/{owner}/{repo}` route.
- Create from a branch-specific repo entry.

#### Edge Cases

- GitHub is disconnected -> The UI asks for connection, not a repo selection dead end.

### STORY-005: User Sends A First Chat Message And Adjusts Chat Controls

**Type**: medium
**Topic**: Chat controls
**Persona**: Regular developer
**Goal**: Send a prompt and understand the model/runtime/tool controls.
**Preconditions**: User is in an existing chat.

#### Steps

1. Type a simple coding question into the composer -> Text wraps without layout breakage.
2. Open the model selector -> Models are grouped by real provider, including user profiles under provider names.
3. Open the runtime selector -> Direct and Coordinated choices are understandable.
4. Open tools or workflow picker -> Available tool choices are visible and selectable.
5. Send the message -> The user sees streaming/progress state and can stop if needed.

#### Variations

- User selects a Cursor, Fireworks, ZAI, or OpenAI-compatible profile model.

#### Edge Cases

- Provider preflight fails -> The message clearly says what profile/key/endpoint needs attention.

### STORY-006: User Opens A Repository Dashboard

**Type**: medium
**Topic**: Repository dashboard
**Persona**: Repo owner
**Goal**: Understand repo status before launching agents.
**Preconditions**: User is signed in and can access the repository.

#### Steps

1. Navigate to `/repos/{owner}/{repo}` or `/{owner}/{repo}`.
2. Confirm the repo name is prominent.
3. Open GitHub, PR, Issues, and Actions areas.
4. Open Agents settings.
5. Return to the sessions/workspace area.

#### Variations

- Repository is not accessible -> The app offers a connection/install path.

#### Edge Cases

- GitHub API fails -> The dashboard shows a contained error and retry path.

### STORY-007: User Reviews Files And Diffs In A Repo Chat

**Type**: medium
**Topic**: Repo session review
**Persona**: Cautious developer
**Goal**: Inspect what the agent changed before committing.
**Preconditions**: User is in a repo-backed chat with a sandbox.

#### Steps

1. Open the Files panel -> File tree loads or shows a helpful empty state.
2. Select a file -> File content displays with readable code formatting.
3. Open Changes -> Diff view shows changed files.
4. Inspect a file diff -> Added/removed lines are legible.
5. Return to chat -> Main conversation state is preserved.

#### Variations

- No changes exist -> The Changes panel says “No file changes yet”.

#### Edge Cases

- File fetch fails -> Error is scoped to the file pane with retry/reload guidance.

### STORY-008: User Commits And Creates A Pull Request

**Type**: long
**Topic**: Repo publishing
**Persona**: Power user
**Goal**: Turn agent changes into a PR.
**Preconditions**: Repo chat has changes and GitHub permissions.

#### Steps

1. Open Changes.
2. Generate or edit a commit message.
3. Commit changes.
4. Open PR panel.
5. Generate PR details.
6. Create PR.
7. Review PR readiness and deployment URL.
8. Merge or close PR if allowed.

#### Variations

- Missing changes -> Commit action is disabled with clear copy.
- Missing GitHub permissions -> PR action explains connection requirements.

#### Edge Cases

- Merge blocked -> The reason is specific, not a generic failure.

### STORY-009: User Recovers From Sandbox Startup Failure

**Type**: medium
**Topic**: Sandbox recovery
**Persona**: Returning developer
**Goal**: Understand and recover when the workspace cannot start.
**Preconditions**: Session has failed or inactive sandbox state.

#### Steps

1. Open the affected chat.
2. Read the workspace startup status.
3. Click retry/resume/reconnect if available.
4. Open runtime observability evidence.
5. Confirm status changes are visible and timestamped.

#### Variations

- Sandbox expired after inactivity -> User can restart without losing chat context.

#### Edge Cases

- Retry fails -> Failure reason includes service/repo/session attribution.

### STORY-010: User Configures Model Preferences And Inference Profiles

**Type**: long
**Topic**: Models and inference
**Persona**: Power user
**Goal**: Configure default models and user-paid endpoints.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/settings/models`.
2. Change the default model.
3. Change the subagent model.
4. Open Manage models and filter by provider/search.
5. Save a shortlist.
6. Click New Inference Profile.
7. Select provider type.
8. Fill name, base URL, model IDs when needed, and key.
9. Save or cancel without losing existing keys.
10. Test an existing profile.
11. Create or edit a model variant.

#### Variations

- OpenAI-compatible profile uses a Cursor Composer preset.
- Anthropic-compatible Fireworks profile keeps existing key when edit key field is blank.

#### Edge Cases

- Invalid endpoint/key -> Test failure is actionable and redacted.

### STORY-011: User Creates A Model Variant

**Type**: short
**Topic**: Model variants
**Persona**: Regular developer
**Goal**: Save a named preset for a model.
**Preconditions**: User is on `/settings/models`.

#### Steps

1. Click New Variant -> Dialog opens.
2. Choose base model.
3. Add provider options.
4. Save -> Variant appears in the list.
5. Edit/delete the variant -> Confirmation and result are clear.

#### Variations

- Built-in variants are visible but protected.

#### Edge Cases

- Invalid JSON/options -> Inline validation points at the failing field.

### STORY-012: User Configures Composio Tools

**Type**: medium
**Topic**: Composio
**Persona**: Tool-heavy developer
**Goal**: Connect and scope external tools.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/settings/composio`.
2. Review connection status.
3. Open Connect tools.
4. Search/select a toolkit.
5. Save default tools for agents.
6. Return to chat and open tool selector.

#### Variations

- Composio unavailable -> Settings explain what config is missing.

#### Edge Cases

- External OAuth canceled -> User returns to a stable settings state.

### STORY-013: User Registers An MCP Server

**Type**: medium
**Topic**: MCP
**Persona**: Integration developer
**Goal**: Add a custom MCP server to the account.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/settings/mcp`.
2. Click add/new server.
3. Enter name, URL, transport, and any headers.
4. Save the server.
5. Disable and re-enable it.
6. Delete it with confirmation.

#### Variations

- Server has no headers.
- Server requires headers.

#### Edge Cases

- Invalid URL -> Form validation prevents save and explains the expected format.

### STORY-014: User Creates And Manages A Skill

**Type**: medium
**Topic**: Skills
**Persona**: Power user
**Goal**: Add a reusable slash skill.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/settings/skills`.
2. Click create/new skill.
3. Add a slash command name and description.
4. Save the skill.
5. Disable and re-enable it.
6. Edit content.
7. Delete it with confirmation.

#### Variations

- Generate a skill using AI-assisted generation.

#### Edge Cases

- Duplicate skill name -> Inline error identifies the conflict.

### STORY-015: User Creates And Tests A Background Agent

**Type**: medium
**Topic**: Background agents
**Persona**: Repo owner
**Goal**: Configure unattended repo work.
**Preconditions**: User has GitHub repo access and background agents are enabled.

#### Steps

1. Navigate to `/settings/background-agents`.
2. Review readiness verdict.
3. Click Create agent.
4. Choose repository, trigger, schedule, model/runtime, and prompt.
5. Save enabled.
6. Click Test.
7. Open a background run detail page.

#### Variations

- Feature disabled -> The user sees why and what env is required.

#### Edge Cases

- Repo not ready -> The readiness panel names missing requirements.

### STORY-016: User Builds And Runs An Agent Loop

**Type**: medium
**Topic**: Loops
**Persona**: Automation owner
**Goal**: Create a repeatable workflow.
**Preconditions**: Loops are enabled.

#### Steps

1. Navigate to `/loops`.
2. Click New loop.
3. Choose manual, template, or plain-English creation.
4. Open builder.
5. Add an agent step and a condition.
6. Save.
7. Run the loop.
8. Pause, resume, cancel, or retry a run.

#### Variations

- Loops disabled -> Disabled panel is visible and actionable for operators.

#### Edge Cases

- Invalid loop graph -> Builder explains the missing connection or invalid node.

### STORY-017: User Reviews Usage And Leaderboard

**Type**: medium
**Topic**: Usage and leaderboard
**Persona**: Cost-conscious developer
**Goal**: Understand spend, model usage, and ranking.
**Preconditions**: User is signed in.

#### Steps

1. Navigate to `/settings/usage`.
2. Change date range if available.
3. Review token/cost/model/repo breakdowns.
4. Navigate to `/settings/leaderboard`.
5. Review domain leaderboard and empty-state copy.
6. Navigate to the public profile route if enabled.

#### Variations

- No usage exists -> Empty state is helpful.

#### Edge Cases

- Usage API fails -> The page shows retryable failure copy.

### STORY-018: User Shares A Chat And Opens The Public View

**Type**: short
**Topic**: Sharing
**Persona**: Regular developer
**Goal**: Share a useful chat transcript.
**Preconditions**: User is in a chat with share permissions.

#### Steps

1. Open share controls.
2. Create or copy a share link.
3. Open `/shared/[shareId]` in a fresh tab.
4. Confirm the public view has readable messages and no private controls.

#### Variations

- Share is revoked or missing -> Public route shows a not-found or unavailable state.

#### Edge Cases

- Shared chat is still generating -> Public status route communicates pending state clearly.
