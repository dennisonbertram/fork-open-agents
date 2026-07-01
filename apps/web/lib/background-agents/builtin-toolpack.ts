/**
 * Product-level "Standard toolpack" definition for background agents.
 *
 * This mirrors (a subset of) the built-in tool registry exposed by
 * `openAgent` in packages/agent/open-agent.ts. Every name here MUST be a
 * real open-agent tool name — a regression test in agent-spec.test.ts
 * asserts STANDARD_TOOLPACK_TOOL_NAMES is a subset of OPEN_AGENT_TOOL_NAMES
 * so this list can't silently drift from the actual tool registry.
 *
 * web_fetch is the one built-in that makes unauthenticated outbound HTTP
 * calls, auto-approved with no human gate in unattended background-agent
 * runs (see packages/agent/tools/fetch.ts). It is intentionally excluded
 * from DEFAULT_ON_TOOL_NAMES so new agents do not get it enabled unless a
 * user explicitly opts in via the Standard toolpack UI.
 */
export const STANDARD_TOOLPACK_TOOL_NAMES = [
  "todo_write",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
  "task",
  "ask_user_question",
  "skill",
  "web_fetch",
] as const;

export const DEFAULT_ON_TOOL_NAMES = STANDARD_TOOLPACK_TOOL_NAMES.filter(
  (name) => name !== "web_fetch",
);

export type StandardToolpackItem = {
  name: (typeof STANDARD_TOOLPACK_TOOL_NAMES)[number];
  label: string;
  caption?: string;
};

export const STANDARD_TOOLPACK_ITEMS: StandardToolpackItem[] = [
  { name: "todo_write", label: "Todo tracking" },
  { name: "read", label: "Read files" },
  { name: "write", label: "Write files" },
  { name: "edit", label: "Edit files" },
  { name: "grep", label: "Search file contents (grep)" },
  { name: "glob", label: "Find files (glob)" },
  { name: "bash", label: "Run shell commands" },
  { name: "task", label: "Delegate to subagents" },
  { name: "ask_user_question", label: "Ask a clarifying question" },
  { name: "skill", label: "Load skills" },
  {
    name: "web_fetch",
    label: "Fetch external URLs",
    caption: "Reaches external URLs, unauthenticated — off by default",
  },
];
