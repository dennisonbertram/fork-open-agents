// Tool-part extraction for `open_agents_get_messages`.
//
// A message's `parts` jsonb column can hold raw AI SDK UIMessage parts, and a
// tool part's `input`/`output` are themselves arbitrary JSON — in real data
// the whole `parts` column has reached 464,565 characters. Dumping tool
// parts verbatim into an MCP response would make one message's trace bigger
// than the entire budget, so every field this module returns is bounded.
//
// Lives in its own module (not tools/sessions-read.ts) per the repo's
// file-organization rules: sessions-read.ts already owns five tools' worth
// of mapping logic, and tool-trace extraction is a distinct concern.

/** The shape a raw jsonb message part can take. Every field is optional and
 * untyped at the source, so nothing here can be trusted without narrowing. */
export type RawMessagePart = {
  type?: unknown;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
};

/** Cap on each of a tool trace entry's `input`/`output` fields, independent
 * of the response-level character budget in tools/sessions-read.ts. */
export const TOOL_TRACE_FIELD_CHARS = 2000;

export type McpToolTraceEntry = {
  toolCallId: string;
  name: string;
  state: string;
  input: string;
  inputTruncated: boolean;
  output: string;
  outputTruncated: boolean;
};

function isToolPart(part: RawMessagePart): boolean {
  return (
    typeof part?.type === "string" &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool")
  );
}

function toolNameOf(part: RawMessagePart): string {
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  if (typeof part.toolName === "string") {
    return part.toolName;
  }
  return "unknown";
}

/**
 * Bound one field to TOOL_TRACE_FIELD_CHARS, marking whether it was cut.
 *
 * Never a silent cut: the caller always gets `truncated` alongside the text,
 * per the issue's "never silently shorten anything" requirement.
 */
function boundField(value: unknown): { text: string; truncated: boolean } {
  if (value === undefined) {
    return { text: "", truncated: false };
  }
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = "[unserializable]";
  }
  if (serialized.length <= TOOL_TRACE_FIELD_CHARS) {
    return { text: serialized, truncated: false };
  }
  return {
    text: `${serialized.slice(0, TOOL_TRACE_FIELD_CHARS - 1)}…`,
    truncated: true,
  };
}

/**
 * Build an ordered tool trace for one message's parts. Non-tool parts (text,
 * reasoning, etc.) are skipped; order is preserved from the source array.
 */
export function buildToolTrace(parts: RawMessagePart[]): McpToolTraceEntry[] {
  return parts.filter(isToolPart).map((part) => {
    const input = boundField(part.input);
    // A failed tool call carries `errorText` instead of `output`; surface it
    // through the same bounded `output` field rather than dropping it.
    const output = boundField(part.output ?? part.errorText);
    return {
      toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : "",
      name: toolNameOf(part),
      state: typeof part.state === "string" ? part.state : "unknown",
      input: input.text,
      inputTruncated: input.truncated,
      output: output.text,
      outputTruncated: output.truncated,
    };
  });
}
