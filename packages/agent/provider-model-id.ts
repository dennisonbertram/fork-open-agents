/**
 * A model id that has actually been resolved to something a provider can
 * consume — never an unparsed internal composite such as
 * `user-profile:<profileId>:<modelId>` (see #1123, #1146, #1150). Before this
 * brand existed, `AgentModelSelection.id: GatewayModelId` accepted any string
 * (the SDK type ends in `| (string & {})`), so a composite id compiled into a
 * provider call and failed only at request time.
 *
 * This is a nominal (branded) type — a plain `string` is not assignable to
 * it. The only way to produce one is {@link toProviderModelId}.
 *
 * ABSOLUTE RULE: never write `as ProviderModelId` anywhere outside
 * {@link toProviderModelId}'s own implementation. Casting elsewhere defeats
 * the entire point of the brand — an internal composite id would once again
 * silently compile into a provider call. If a call site cannot obtain a
 * `ProviderModelId` without casting, that's a bug in the site (it needs to
 * resolve the composite first, e.g. via
 * `resolveInferenceProfileModelSelection`), not a reason to cast.
 */
export type ProviderModelId = string & {
  readonly __providerBound: unique symbol;
};

/**
 * Mirrors `USER_INFERENCE_OPTION_PREFIX` in
 * `apps/web/lib/inference/model-option-id.ts` — that file is the canonical
 * definition (composite option ids are a web-app concept), but this package
 * cannot import from `apps/web`, so the prefix is duplicated here as a
 * runtime guard. If that prefix ever changes, update both.
 */
const INTERNAL_COMPOSITE_MODEL_ID_PREFIX = "user-profile:";

/**
 * Thrown by {@link toProviderModelId} when handed a value that is still an
 * unresolved internal composite id, instead of silently branding it.
 */
export class UnresolvedCompositeModelIdError extends Error {
  override readonly name = "UnresolvedCompositeModelIdError";

  constructor(modelId: string) {
    super(
      `toProviderModelId() received an unresolved internal composite id: ` +
        `${JSON.stringify(modelId)}. This must be parsed first — e.g. via ` +
        `parseModelOptionSelection()/resolveInferenceProfileModelSelection() — ` +
        `and only the resulting real model id may be minted, not the composite.`,
    );
  }
}

/**
 * The sole mint for {@link ProviderModelId}. Call this only once `modelId`
 * has already been resolved to a real provider id.
 *
 * This is a runtime boundary, not just a type-level one: a value that still
 * starts with the internal composite prefix (`user-profile:<profileId>:` —
 * see #1123, #1146, #1150, #1155) is rejected outright rather than blessed,
 * so a call site cannot launder an unresolved id through the mint by simply
 * wrapping it.
 */
export function toProviderModelId(modelId: string): ProviderModelId {
  if (modelId.startsWith(INTERNAL_COMPOSITE_MODEL_ID_PREFIX)) {
    throw new UnresolvedCompositeModelIdError(modelId);
  }
  return modelId as ProviderModelId;
}
