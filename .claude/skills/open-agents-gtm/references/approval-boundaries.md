# GTM Approval Boundaries

GTM agents can create local drafts, summaries, proposed actions, and approval
requests. They must not perform external mutations until an explicit approval
record permits the specific action.

## Requires Approval

- Email draft creation through an external provider.
- Email sending.
- CRM note creation.
- CRM account or contact updates.
- CRM sequence enrollment.
- Public GitHub issue creation or filing an activation/product-signal issue.
- Promoting durable GTM learning candidates into long-term agent context.

## Allowed Without External Approval

- Reading repo docs, issues, PRs, local code, and existing GTM API responses.
- Creating local GTM draft rows and redacted previews.
- Creating pending approval records.
- Producing a user-visible draft, plan, or checklist.
- Reporting source gaps.

## Required Response For Unsafe Mutation Requests

If asked to send, enroll, update CRM, or file a public issue directly:

1. State that approval is required.
2. Produce the draft/proposed action.
3. Name the approval target and evidence used.
4. Do not call the external system.

## Redaction

Never include raw tokens, OAuth headers, secrets, passwords, private contact
details, full email bodies, full call transcripts, or raw CRM notes in final
answers, issue bodies, PR descriptions, event payloads, or generated prompt
artifacts. Use bounded summaries, IDs, hashes, and evidence references.
