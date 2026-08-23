---
name: open-agents-mcp
description: Connect a coding harness to the Open Agents hosted MCP server so work can be dispatched to cloud sandboxes on a GitHub repo. Use when adding the Open Agents MCP server to a client, authenticating it, checking whether it is connected, or dispatching and supervising a remote coding session.
---

Connect a harness to the Open Agents MCP control plane, then dispatch coding
work to cloud sandboxes.

This skill covers **getting connected and operating the loop**. It deliberately
does not restate what each tool does: the server ships long, accurate
descriptions and JSON schemas with every tool, and those are the contract. Read
them from the client rather than trusting a summary here.

## What this connects to

A hosted MCP server that runs coding agents in isolated cloud sandboxes against
a linked GitHub repo. A dispatched run provisions its own sandbox, works on a
branch, and can commit, push, and open a PR under the authorising user's
account.

Endpoint: `https://open-agents-dennisons-projects.vercel.app/api/mcp/mcp`

That host is one of several Vercel aliases for the same production deployment.
If a different alias is in use, the same paths work — but confirm the alias
serves the current build before blaming the server for a missing tool.

## Connect

### Claude Code

```bash
claude mcp add --transport http open-agents \
  https://open-agents-dennisons-projects.vercel.app/api/mcp/mcp
```

Then authenticate. The server uses OAuth with dynamic client registration, so
there is no API key to paste and nothing to configure by hand.

**From a terminal** — the supported CLI flow, and the one to reach for first:

```bash
claude mcp login open-agents

# SSH or headless: print the URL instead of opening a browser,
# then paste the redirect URL back when prompted.
claude mcp login open-agents --no-browser
```

`claude mcp list` and `claude mcp get open-agents` report whether the server is
connected. `claude mcp logout open-agents` clears stored credentials.

**From inside an agent session**, some harnesses instead expose the OAuth flow
as two model-callable tools on the server — `authenticate`, which returns an
authorization URL for the user to approve, and `complete_authentication`, which
takes the callback URL. Use them when the client offers them; they are not part
of the Claude Code CLI, so `claude mcp login` remains the path at a terminal.

Either way, one detail catches people out: after approving, the browser is
redirected to `http://localhost:<port>/callback?code=…&state=…`. On a remote or
headless session **that page will fail to load — the URL in the address bar is
still valid**, and it is what the CLI prompt or `complete_authentication` wants.

Once authorization succeeds the server's real tools become available.

### Any other MCP client

Point it at the endpoint above with HTTP transport. Discovery is standard and
already verified to respond:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

Scopes advertised: `sessions:read`, `sessions:write`, `agents:read`,
`agents:write`, `sandbox:exec`, plus `openid`, `profile`, `email`,
`offline_access`.

## Check whether you are actually connected

Two distinct failures look the same from a chat window: the server being down,
and this session not holding a token. Separate them before debugging anything.

**Is the session connected?** From a terminal, `claude mcp get open-agents`
reports connection status directly. From inside an agent session, look at which
tools the client exposes for this server: if the only ones present are
`authenticate` and `complete_authentication`, you are **not** connected — the
real tools load only after OAuth. Once connected, `open_agents_whoami` is the
cheapest confirmation that the token works, and it reports which account it
belongs to.

**Is the server up?** An unauthenticated request should return `401` with a
`WWW-Authenticate: Bearer resource_metadata="…"` header:

```bash
curl -s -o /dev/null -D - -X POST \
  https://open-agents-dennisons-projects.vercel.app/api/mcp/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```

That `401` is the healthy answer, not a fault. A `404`, a timeout, or a `401`
with no `WWW-Authenticate` header is a real problem.

## The tool surface

Ten tools, split by scope. Names only — read the server's own descriptions for
behaviour, which are detailed and authoritative.

Read (`sessions:read`): `open_agents_whoami`, `open_agents_list_sessions`,
`open_agents_get_session`, `open_agents_get_messages`,
`open_agents_get_updates`, `open_agents_get_diff_summary`.

Write (`sessions:write`): `open_agents_start_session`,
`open_agents_send_message`, `open_agents_stop_run`,
`open_agents_archive_session`.

`start_session` and `send_message` both carry `destructiveHint: true`, and that
is correct rather than cautious: a run inherits the account's auto-commit and
auto-PR settings, so it can delete files, rewrite a branch, and push. Never let
a client auto-approve them.

## Dispatching work

`open_agents_start_session` takes `repoOwner`, `repoName` and `prompt`, with
optional `branch`, `isNewBranch`, `runtimeMode`, `autoCommit`, `model`,
`expectFileChanges` and `expectedFiles`.

Four behaviours that catch people out, all stated in the tool's own description
and worth knowing before the first call:

- **It is not idempotent.** Every call provisions a new sandbox and starts a new
  billed run, even with identical inputs. A retry after a timeout is a second
  run, not a resumption.
- **It returns before the sandbox is ready.** Poll `open_agents_get_session`
  until its `workspace` field reports ready before assuming anything is usable.
- **`branch` means the branch to start FROM.** By default the agent works on a
  freshly created branch and the auto-created PR targets `branch`. Pass
  `isNewBranch: false` only when the branch is known to accept direct pushes —
  auto-commit onto a protected branch fails silently. `get_session`'s
  `baseBranch` confirms what a session actually started from.
- **Declare your expectations.** `expectFileChanges` stops a run that produces
  no workspace change; `expectedFiles` names the only paths the run may touch
  and reports `lastRunOutcome: "diff_violation"` when it strays. Raise the
  allowance for prompts that must read a lot before writing, and omit it
  entirely for read-only analysis runs.

## Operating discipline

Read `docs/process/dogfood-cloud-fanout.md` before dispatching real work. It is
the hard-won version of this and carries the evidence. The three rules that
matter most:

- **Never merge on a green status.** A slice reports `completed` whether its
  output is excellent or unusable. Read the whole diff, confirm no file outside
  the assigned list changed, and run its tests locally.
- **Write the acceptance condition before dispatching** — "only these files may
  change, no existing line may be modified" — so grading is a mechanical check
  on the diff rather than a judgement call afterwards.
- **Verify the push, not the success message.** A run can report success and
  have lost its work to a protected-branch rejection.

## Provenance of this skill

The endpoint, discovery responses, advertised scopes and the `401` signature
were verified live against production. The `claude mcp add`, `login`,
`--no-browser`, `list`, `get` and `logout` commands were taken from the CLI's
own `--help` output rather than from memory. The tool names, scopes, annotations and
`start_session` input schema were read from the server source in
`apps/web/lib/mcp-server/`. An end-to-end dispatch was **not** executed while
writing this, so treat the dispatch section as accurate about the contract and
unproven about live behaviour until you have run one.
