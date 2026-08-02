/**
 * A session with no (or no longer runtime) sandbox is a normal lifecycle state,
 * not a malformed request, so sandbox-dependent sub-resources answer 409 with a
 * typed `errorKind` clients can branch on without string-matching. See #1057.
 */
export function sandboxNotInitializedResponse(
  message = "Sandbox not initialized",
  status = 409,
): Response {
  return Response.json(
    { error: message, errorKind: "sandbox_not_initialized" },
    { status },
  );
}
