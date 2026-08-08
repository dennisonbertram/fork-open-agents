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
 * The sole mint for {@link ProviderModelId}. Call this only once `modelId`
 * has already been resolved to a real provider id — it performs the
 * type-level branding and nothing else; it does not parse or validate
 * composite id shapes.
 */
export function toProviderModelId(modelId: string): ProviderModelId {
  return modelId as ProviderModelId;
}
