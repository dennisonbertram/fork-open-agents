import { getHarnessConfig } from "./config";
import { redactHarnessPayload } from "./redaction";

type HarnessLogLevel = "info" | "warn" | "error";

export type HarnessLogEvent = {
  event: string;
  request_id?: string;
  session_id?: string;
  chat_id?: string;
  verified_build_run_id?: string;
  harness_run_id?: string;
  method?: string;
  path?: string;
  status?: number | string;
  duration_ms?: number;
  harness_status?: string;
  tenant_id?: string;
  project_id?: string | null;
  actor_id?: string;
  error_code?: string;
  [key: string]: unknown;
};

export function logHarnessEvent(
  level: HarnessLogLevel,
  event: HarnessLogEvent,
): void {
  let shouldLog = false;
  try {
    shouldLog = getHarnessConfig().logJson;
  } catch {
    shouldLog = process.env.HARNESS_LOG_JSON === "true";
  }

  if (!shouldLog) {
    return;
  }

  const payload = redactHarnessPayload({
    ...event,
    timestamp: new Date().toISOString(),
  });
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}
