/**
 * Regression tests for issue #1054 frontend error-body adoption in hooks.
 *
 * BT-1054-H1: a non-ok response with an EMPTY body surfaces the hook's own
 * fallback message, not a JSON parse error.
 * BT-1054-H2: a non-ok response with a NON-JSON (HTML gateway) body does the
 * same.
 * BT-1054-H3: an unreadable SUCCESS body is a failure — it must surface an
 * error, never resolve as a silent success.
 */

import { act, registerDomTestHooks, render } from "@/tests/dom";
import { beforeEach, describe, expect, mock, test } from "bun:test";

registerDomTestHooks();

let capturedFetchers: unknown[] = [];

mock.module("swr", () => ({
  default: (_key: unknown, fetcher: unknown) => {
    capturedFetchers.push(fetcher);
    return {
      data: undefined,
      error: null,
      isLoading: false,
      mutate: async () => undefined,
    };
  },
  useSWRConfig: () => ({ mutate: async () => undefined }),
}));

const { useSessions } = await import("./use-sessions");
const { useSessionChats } = await import("./use-session-chats");
const { useUserPreferences } = await import("./use-user-preferences");
const { useRepoLoops } = await import("./use-repo-loops");
const { useAudioRecording } = await import("./use-audio-recording");

function stubFetch(response: Response) {
  globalThis.fetch = (() =>
    Promise.resolve(response)) as unknown as typeof fetch;
}

function emptyBody(status: number) {
  return new Response(null, { status });
}

function htmlBody(status: number) {
  return new Response("<html><body>502 Bad Gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

/** Renders a hook and returns its latest value. */
function renderHookValue<T>(useHook: () => T): () => T {
  let latest: T | undefined;
  function Probe() {
    latest = useHook();
    return null;
  }
  render(<Probe />);
  return () => latest as T;
}

beforeEach(() => {
  capturedFetchers = [];
});

describe("useSessions", () => {
  test("renameSession falls back when the error body is empty", async () => {
    stubFetch(emptyBody(500));
    const get = renderHookValue(() => useSessions());

    await expect(get().renameSession("session-1", "New")).rejects.toThrow(
      "Failed to rename session",
    );
  });

  test("createSession falls back when the error body is not JSON", async () => {
    stubFetch(htmlBody(502));
    const get = renderHookValue(() => useSessions());

    await expect(
      get().createSession({
        isNewBranch: false,
        sandboxType: "vercel",
        autoCommitPush: false,
        autoCreatePr: false,
      }),
    ).rejects.toThrow("Couldn't create the session — try again");
  });
});

describe("useSessionChats", () => {
  test("renameChat falls back when the error body is not JSON", async () => {
    stubFetch(htmlBody(502));
    const get = renderHookValue(() => useSessionChats("session-1"));

    await expect(get().renameChat("chat-1", "New")).rejects.toThrow(
      "Failed to rename chat",
    );
  });
});

describe("useUserPreferences", () => {
  test("updatePreferences falls back when the error body is empty", async () => {
    stubFetch(emptyBody(500));
    const get = renderHookValue(() => useUserPreferences());

    await expect(
      get().updatePreferences({ autoCreatePr: true }),
    ).rejects.toThrow("Failed to update preferences");
  });
});

describe("useRepoLoops", () => {
  test("fetcher falls back to statusText when the error body is empty", async () => {
    renderHookValue(() =>
      useRepoLoops({ repoOwner: "o", repoName: "r", enabled: true }),
    );
    const fetcher = capturedFetchers.find(
      (candidate) => typeof candidate === "function",
    ) as (url: string) => Promise<unknown>;

    stubFetch(
      new Response("<html>502</html>", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    await expect(fetcher("/api/repos/o/r/loops")).rejects.toThrow(
      "Bad Gateway",
    );
  });
});

describe("useAudioRecording", () => {
  function stubMediaRecorder() {
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      onstop: (() => void) | null = null;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      start() {
        this.ondataavailable?.({ data: new Blob(["audio"]) });
      }
      stop() {
        this.onstop?.();
      }
    }
    (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [] }),
      },
    });
  }

  test("an unreadable success body surfaces an error instead of a silent null", async () => {
    stubMediaRecorder();
    const get = renderHookValue(() => useAudioRecording());

    stubFetch(new Response("", { status: 200 }));
    await act(async () => {
      await get().startRecording();
    });

    let transcript: string | null = "unset";
    await act(async () => {
      transcript = await get().stopRecording();
    });

    expect(transcript).toBeNull();
    expect(get().error).toBeTruthy();
  });

  test("an empty error body surfaces the transcription fallback", async () => {
    stubMediaRecorder();
    const get = renderHookValue(() => useAudioRecording());

    stubFetch(emptyBody(500));
    await act(async () => {
      await get().startRecording();
    });
    await act(async () => {
      await get().stopRecording();
    });

    expect(get().error).toContain("Transcription failed");
  });
});
