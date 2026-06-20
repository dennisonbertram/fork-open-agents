const ANTHROPIC_DIRECT_MODEL_IDS: Record<string, string> = {
  "anthropic/claude-haiku-4.5": "claude-haiku-4-5",
  "anthropic/claude-opus-4": "claude-opus-4-0",
  "anthropic/claude-opus-4.1": "claude-opus-4-1",
  "anthropic/claude-opus-4.5": "claude-opus-4-5",
  "anthropic/claude-opus-4.6": "claude-opus-4-6",
  "anthropic/claude-opus-4.7": "claude-opus-4-7",
  "anthropic/claude-opus-4.8": "claude-opus-4-8",
  "anthropic/claude-sonnet-4": "claude-sonnet-4-0",
  "anthropic/claude-sonnet-4.5": "claude-sonnet-4-5",
  "anthropic/claude-sonnet-4.6": "claude-sonnet-4-6",
};

export function toAnthropicDirectModelId(modelId: string): string | null {
  if (!modelId.startsWith("anthropic/")) {
    return null;
  }

  const mappedModelId = ANTHROPIC_DIRECT_MODEL_IDS[modelId];
  if (mappedModelId) {
    return mappedModelId;
  }

  return modelId.slice("anthropic/".length).replaceAll(".", "-");
}
