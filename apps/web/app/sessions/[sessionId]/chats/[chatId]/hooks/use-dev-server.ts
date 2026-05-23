"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { DevServerLaunchResponse } from "@/app/api/sessions/[sessionId]/dev-server/route";

type RuntimeDevServerLaunchResponse = DevServerLaunchResponse & {
  id?: string;
  logPath?: string | null;
};

export type DevServerLaunchState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "stopping"; info: RuntimeDevServerLaunchResponse }
  | { status: "error"; message: string }
  | { status: "ready"; info: RuntimeDevServerLaunchResponse };

type BrowserCheckState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "passed"; summary: string }
  | { status: "failed"; summary: string };

export interface DevServerControls {
  state: DevServerLaunchState;
  menuLabel: string;
  menuDetail: string | null;
  showStopAction: boolean;
  showManagedActions: boolean;
  browserCheckState: BrowserCheckState;
  handlePrimaryAction: () => Promise<void>;
  handleStopAction: () => Promise<void>;
  handleBrowserCheck: () => Promise<void>;
  handleOpenLogs: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body) || typeof body.error !== "string") {
    return fallback;
  }

  return body.error;
}

function parseLaunchResponse(
  body: unknown,
): RuntimeDevServerLaunchResponse | null {
  if (!isRecord(body)) {
    return null;
  }

  const { packagePath, port, url } = body;
  if (
    typeof packagePath !== "string" ||
    typeof port !== "number" ||
    !Number.isFinite(port) ||
    typeof url !== "string"
  ) {
    return null;
  }

  return {
    ...(typeof body.id === "string" ? { id: body.id } : {}),
    packagePath,
    port,
    url,
    ...(typeof body.logPath === "string" || body.logPath === null
      ? { logPath: body.logPath }
      : {}),
  };
}

export function useDevServer({
  sessionId,
  chatId,
  canRun,
  runtimeMode,
}: {
  sessionId: string;
  chatId: string;
  canRun: boolean;
  runtimeMode: "classic" | "managed_runtime";
}): DevServerControls {
  const [state, setState] = useState<DevServerLaunchState>({ status: "idle" });
  const [browserCheckState, setBrowserCheckState] = useState<BrowserCheckState>(
    { status: "idle" },
  );

  useEffect(() => {
    setState({ status: "idle" });
    setBrowserCheckState({ status: "idle" });
  }, [sessionId]);

  useEffect(() => {
    if (!canRun) {
      setState({ status: "idle" });
    }
  }, [canRun]);

  useEffect(() => {
    if (!canRun || runtimeMode !== "managed_runtime") {
      return;
    }

    let cancelled = false;

    async function loadManagedService() {
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/sandbox-services`,
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !isRecord(body) || !Array.isArray(body.services)) {
          return;
        }

        const service = body.services.find(
          (candidate) =>
            isRecord(candidate) &&
            candidate.kind === "dev_server" &&
            candidate.status === "running",
        );
        const launchResponse = parseLaunchResponse(service);
        if (!cancelled && launchResponse) {
          setState({ status: "ready", info: launchResponse });
        }
      } catch (error) {
        console.error("Failed to load managed dev server:", error);
      }
    }

    void loadManagedService();

    return () => {
      cancelled = true;
    };
  }, [canRun, runtimeMode, sessionId]);

  const openDevServerUrl = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (state.status === "ready") {
      openDevServerUrl(state.info.url);
      return;
    }

    if (state.status === "starting" || state.status === "stopping") {
      return;
    }

    setState({ status: "starting" });
    const toastId = toast.loading(
      runtimeMode === "managed_runtime"
        ? "Starting managed dev server..."
        : "Starting dev server...",
      {
        description:
          runtimeMode === "managed_runtime"
            ? "Detecting the app, installing dependencies, and opening a sandbox URL."
            : undefined,
      },
    );

    try {
      const response = await fetch(
        runtimeMode === "managed_runtime"
          ? `/api/sessions/${sessionId}/sandbox-services`
          : `/api/sessions/${sessionId}/dev-server`,
        { method: "POST" },
      );
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to launch dev server"));
      }

      const launchResponse =
        runtimeMode === "managed_runtime" && isRecord(body)
          ? parseLaunchResponse(body.service)
          : parseLaunchResponse(body);
      if (!launchResponse) {
        throw new Error("Invalid dev server response");
      }

      setState({
        status: "ready",
        info: launchResponse,
      });
      toast.success("Dev server is ready", {
        id: toastId,
        description: launchResponse.url,
      });
    } catch (error) {
      console.error("Failed to launch dev server:", error);
      const message =
        error instanceof Error ? error.message : "Failed to launch dev server";
      setState({
        status: "error",
        message,
      });
      toast.error("Dev server failed", {
        id: toastId,
        description: message,
      });
    }
  }, [openDevServerUrl, sessionId, state, runtimeMode]);

  const handleStopAction = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    setState({ status: "stopping", info: state.info });
    const toastId = toast.loading("Stopping dev server...");

    try {
      const serviceId =
        "id" in state.info && typeof state.info.id === "string"
          ? state.info.id
          : null;
      const response = await fetch(
        runtimeMode === "managed_runtime" && serviceId
          ? `/api/sessions/${sessionId}/sandbox-services/${serviceId}`
          : `/api/sessions/${sessionId}/dev-server`,
        { method: "DELETE" },
      );
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Failed to stop dev server"));
      }

      setState({ status: "idle" });
      setBrowserCheckState({ status: "idle" });
      toast.success("Dev server stopped", { id: toastId });
    } catch (error) {
      console.error("Failed to stop dev server:", error);
      const message =
        error instanceof Error ? error.message : "Failed to stop dev server";
      setState({
        status: "error",
        message,
      });
      toast.error("Failed to stop dev server", {
        id: toastId,
        description: message,
      });
    }
  }, [sessionId, state, runtimeMode]);

  const handleBrowserCheck = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    const serviceId =
      "id" in state.info && typeof state.info.id === "string"
        ? state.info.id
        : undefined;
    setBrowserCheckState({ status: "running" });
    const toastId = toast.loading("Running browser check...", {
      description:
        "Loading the preview, collecting network output, and saving a screenshot.",
    });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/browser-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          targetUrl: state.info.url,
          chatId,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "Browser check failed"));
      }

      const run = isRecord(body) && isRecord(body.run) ? body.run : null;
      const runStatus = run?.status;
      const summary =
        typeof run?.summary === "string"
          ? run.summary
          : runStatus === "passed"
            ? "Preview loaded successfully."
            : "Browser check finished.";
      if (runStatus === "passed") {
        setBrowserCheckState({ status: "passed", summary });
        toast.success("Browser check passed", {
          id: toastId,
          description: summary,
        });
        return;
      }

      setBrowserCheckState({ status: "failed", summary });
      toast.error("Browser check failed", {
        id: toastId,
        description: summary,
      });
    } catch (error) {
      console.error("Browser check failed:", error);
      const message =
        error instanceof Error ? error.message : "Browser check failed";
      setBrowserCheckState({ status: "failed", summary: message });
      toast.error("Browser check failed", {
        id: toastId,
        description: message,
      });
    }
  }, [chatId, sessionId, state]);

  const handleOpenLogs = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    const serviceId =
      "id" in state.info && typeof state.info.id === "string"
        ? state.info.id
        : null;
    if (!serviceId) {
      return;
    }

    window.open(
      `/api/sessions/${sessionId}/sandbox-services/${serviceId}/logs`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [sessionId, state]);

  const menuLabel =
    state.status === "ready"
      ? state.info.packagePath === "root"
        ? "Open Dev Server"
        : `Open ${state.info.packagePath}`
      : state.status === "starting"
        ? "Starting Dev Server..."
        : state.status === "stopping"
          ? "Stopping Dev Server..."
          : state.status === "error"
            ? "Retry Dev Server"
            : "Run Dev Server";
  const menuDetail =
    state.status === "ready" || state.status === "stopping"
      ? state.info.url
      : state.status === "error"
        ? state.message
        : null;
  const showStopAction =
    canRun && (state.status === "ready" || state.status === "stopping");
  const showManagedActions = canRun && runtimeMode === "managed_runtime";

  return {
    state,
    menuLabel,
    menuDetail,
    showStopAction,
    showManagedActions,
    browserCheckState,
    handlePrimaryAction,
    handleStopAction,
    handleBrowserCheck,
    handleOpenLogs,
  } as const;
}
