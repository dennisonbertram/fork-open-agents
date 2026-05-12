const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:/=-]{8,128}$/;

export function isSafeRequestId(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && SAFE_REQUEST_ID_PATTERN.test(value);
}

export function getRequestId(headers?: Headers): string {
  const incomingRequestId = headers?.get("x-request-id");
  if (isSafeRequestId(incomingRequestId)) {
    return incomingRequestId;
  }

  return crypto.randomUUID();
}
