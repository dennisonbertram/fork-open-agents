# Diagnostic Bundles

Diagnostic bundles are bounded, redacted exports for debugging a session chat
without requiring direct database or production shell access.

## Chat Debug Bundle

Endpoint:

```text
GET /api/sessions/:sessionId/chats/:chatId/debug-bundle
```

The owner-authenticated response is JSON by default. Use either
`?format=markdown` or `Accept: text/markdown` for a Markdown report.

To create a short-lived read-only URL for an agent or operator that does not
have the owner's browser cookie:

```text
POST /api/sessions/:sessionId/chats/:chatId/debug-bundle
```

Optional JSON body:

```json
{ "ttlMinutes": 60 }
```

The response includes a signed URL with a maximum 24-hour lifetime. The token is
scoped to the exact session and chat.

## Included Evidence

- session and chat metadata;
- bounded transcript text and summarized tool activity;
- managed runtime profile runs with setup and verification observations;
- workflow run metadata;
- managed runtime service records;
- managed browser run summaries;
- redacted session events.

## Redaction And Limits

Diagnostic bundles redact token-shaped strings and sensitive keys, bound
transcript text per message, and omit raw service log tails and artifact
contents. They are intended for triage and agent inspection, not as a complete
forensic export.
