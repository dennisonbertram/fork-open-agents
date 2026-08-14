import type { WebAgentUIMessage } from "@/app/types";

export type HeadlessActivityState = {
  seenToolCallIds: Set<string>;
};

export function createHeadlessActivityState(): HeadlessActivityState {
  return { seenToolCallIds: new Set() };
}

// TDD stub: intentionally wrong (always null) so the red tests fail on the
// assertion, not on a missing-module import error. Implemented for green in
// the next commit.
export function buildHeadlessStepToolSignature(
  _state: HeadlessActivityState,
  _parts: WebAgentUIMessage["parts"],
): string | null {
  return null;
}
