/**
 * Next.js server startup hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 *
 * `register()` runs once per server runtime instance, before any route
 * handles a request. Registering the sandbox usage meter here — rather than
 * at each call site — is what makes it a true "once at startup" registration
 * per `packages/sandbox/meter.ts`'s contract.
 */
export async function register(): Promise<void> {
  // Guard for nodejs only: this pulls in the Postgres client via
  // registerSandboxMeter, which the edge runtime cannot run, and
  // `register()` otherwise executes in both.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerSandboxMeter } = await import("@/lib/usage/sandbox-meter");
    registerSandboxMeter();
  }
}
