# Open Agents Verified Build Bridge Notes

The bridge entrypoint is `scripts/open-agents-bridge.mjs`.

It intentionally exposes only the harness sandbox contract:

- `workingDirectory`
- `exec(command, cwd, timeoutMs, { signal })`
- optional `execDetached(command, cwd)`
- optional `domain(port)`
- optional `getState()`
- `stop()`

The bridge accepts only `credential-ref:*` values. Raw tokens or provider
credentials are rejected before any sandbox connection is attempted. Abort
signals call `sandbox.stop()` so harness cancellation can converge on the same
cleanup path Open Agents uses.

The current module expects the harness check/live-proof request to provide an
Open Agents `sandbox_state` in `request.sandbox_state`. Hosted credential
brokering and setup-token revocation stay on the Open Agents side before this
module is used for production live proof.
