/**
 * Serialize a user-authored skill into `SKILL.md` content.
 *
 * The agent-side frontmatter parser (`packages/agent/skills/discovery.ts`) is a
 * hand-written single-line YAML reader: it splits each line on the first colon,
 * supports `"`/`'` quoted values, and does NOT support multi-line values. So we
 * collapse `name`/`description`/`allowed-tools` to a single line and quote any
 * value that could contain colons, commas, or quotes. The body is written
 * verbatim after the closing `---` and recovered by `extractSkillBody`.
 */

export type SkillFileInput = {
  name: string;
  description: string;
  body: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
};

/** Directory name a skill is materialized under (`<dir>/SKILL.md`). */
export function skillDirectoryName(name: string): string {
  return name.trim();
}

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Double-quote and escape a value so the single-line YAML reader recovers it. */
function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serializeSkillFile(skill: SkillFileInput): string {
  const allowedTools = (skill.allowedTools ?? [])
    .map((tool) => tool.trim())
    .filter(Boolean);

  const lines = [
    "---",
    `name: ${toSingleLine(skill.name)}`,
    `description: ${quoteYaml(toSingleLine(skill.description))}`,
    ...(skill.disableModelInvocation === true
      ? ["disable-model-invocation: true"]
      : []),
    ...(skill.userInvocable === false ? ["user-invocable: false"] : []),
    ...(allowedTools.length > 0
      ? [`allowed-tools: ${quoteYaml(allowedTools.join(", "))}`]
      : []),
    "---",
  ];

  const body = skill.body.replace(/\s+$/, "");
  return `${lines.join("\n")}\n\n${body}\n`;
}
