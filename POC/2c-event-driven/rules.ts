import type { TriggerRule } from "./types";

/**
 * The default rule set used by the eval. These prove the generalization:
 *
 * - `github-pr-close-archive` subsumes the original
 *   `handlePullRequestWebhook` behavior (wake on PR closed/reopened) as ONE
 *   rule, so the GitHub path is not a regression.
 * - `github-issue-triage`, `email-support-triage`, `deploy-failure-investigate`,
 *   and `sentry-alert-investigate` are the new sources.
 * - `email-bug-report` deliberately overlaps `email-support-triage` so the
 *   multi-rule fan-out case is exercised.
 */
export const defaultRules: TriggerRule[] = [
  {
    id: "github-pr-close-archive",
    description:
      "Subsumes the original handlePullRequestWebhook: wake on PR closed/reopened to update + archive linked sessions.",
    enabled: true,
    when: {
      source: "github",
      type: "github.pull_request.*",
      match: { "metadata.action": { in: ["closed", "reopened"] } },
    },
    action: {
      agentId: "pr-lifecycle-agent",
      promptTemplate:
        "PR #{{metadata.prNumber}} in {{repo.owner}}/{{repo.name}} is now {{metadata.prStatus}} (action={{metadata.action}}). Reconcile and archive linked sessions.",
    },
  },
  {
    id: "github-issue-triage",
    description: "Wake a triage agent when a GitHub issue is opened.",
    enabled: true,
    when: {
      source: "github",
      type: "github.issues.opened",
    },
    action: {
      agentId: "issue-triage-agent",
      promptTemplate:
        "Triage new issue #{{metadata.issueNumber}} in {{repo.owner}}/{{repo.name}}: \"{{subject}}\" opened by {{actor}}.\n\n{{body}}",
    },
  },
  {
    id: "email-support-triage",
    description: "Wake a support agent on any inbound email.",
    enabled: true,
    when: {
      source: "agentmail",
      type: "email.message.received",
    },
    action: {
      agentId: "email-support-agent",
      promptTemplate:
        "New email from {{actor}} to {{metadata.to}}, subject \"{{subject}}\".\n\n{{body}}\n\nReply via thread {{metadata.threadId}}.",
    },
  },
  {
    id: "email-bug-report",
    description:
      "Overlaps email-support-triage to exercise multi-rule fan-out; only fires when the subject mentions a bug.",
    enabled: true,
    when: {
      source: "agentmail",
      type: "email.message.received",
      match: { subject: { contains: "Bug" } },
    },
    action: {
      agentId: "bug-intake-agent",
      promptTemplate:
        "Possible bug report from {{actor}}: \"{{subject}}\". Open a tracking issue.\n\n{{body}}",
    },
  },
  {
    id: "deploy-failure-investigate",
    description: "Wake an agent to investigate a failed deployment.",
    enabled: true,
    when: {
      source: "vercel-deploy",
      type: "deploy.failed",
    },
    action: {
      agentId: "deploy-doctor-agent",
      promptTemplate:
        "Deployment {{metadata.deploymentId}} for project {{metadata.projectName}} (target={{metadata.target}}, branch={{metadata.branch}}) failed. Inspect {{metadata.inspectorUrl}} and propose a fix.",
    },
  },
  {
    id: "sentry-alert-investigate",
    description: "Wake an agent on a high-severity Sentry issue alert.",
    enabled: true,
    when: {
      source: "sentry",
      type: "sentry.issue.alert",
      match: { "metadata.level": { in: ["error", "fatal"] } },
    },
    action: {
      agentId: "error-triage-agent",
      promptTemplate:
        "Sentry {{metadata.level}} alert: \"{{subject}}\" (rule: {{metadata.triggeredRule}}, env: {{metadata.environment}}). Investigate {{metadata.webUrl}}.",
    },
  },
];
