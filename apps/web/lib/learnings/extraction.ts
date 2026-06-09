export function verifyRedaction(
  _text: string,
): {
  status: "passed" | "failed" | "blocked";
  detector?: "pem" | "high_entropy" | "known_prefix";
} {
  throw new Error("verifyRedaction not implemented");
}

export function toEventPayload(
  _candidate: Record<string, unknown>,
): Record<string, unknown> {
  throw new Error("toEventPayload not implemented");
}
