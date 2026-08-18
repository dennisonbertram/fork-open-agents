import { registerDomTestHooks, render, act } from "@/tests/dom";

import { describe, expect, mock, test } from "bun:test";

registerDomTestHooks();

let isMobileValue = false;
let defaultDiffModeValue: "unified" | "split" = "unified";
let focusedDiffFileValue: string | null = "src/example.ts";
let capturedPatchDiffOptions: { diffStyle?: string } | null = null;

mock.module("next/navigation", () => ({
  useParams: () => ({ sessionId: "session-1" }),
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined }),
}));

mock.module("@/hooks/use-mobile", () => ({
  useIsMobile: () => isMobileValue,
}));

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({
    preferences: { defaultDiffMode: defaultDiffModeValue },
    loading: false,
  }),
}));

mock.module("./session-chat-context", () => ({
  useSessionChatWorkspaceContext: () => ({
    diff: {
      files: [
        {
          path: "src/example.ts",
          status: "modified" as const,
          additions: 1,
          deletions: 1,
          diff: "@@ -1,1 +1,1 @@ patch",
        },
      ],
      summary: {
        totalFiles: 1,
        totalAdditions: 1,
        totalDeletions: 1,
      },
    },
    diffLoading: false,
    diffRefreshing: false,
    diffError: null,
    diffCachedAt: null,
    sandboxInfo: { createdAt: Date.now(), timeout: null },
    refreshDiff: async () => {},
    gitStatus: null,
  }),
}));

mock.module("./git-panel-context", () => ({
  useGitPanel: () => ({
    focusedDiffFile: focusedDiffFileValue,
    focusedDiffRequestId: 0,
    diffScope: "branch" as const,
  }),
}));

mock.module("@pierre/diffs/react", () => ({
  PatchDiff: (props: { patch: string; options: { diffStyle?: string } }) => {
    capturedPatchDiffOptions = props.options;
    return (
      <div data-patch={props.patch} data-diff-style={props.options.diffStyle}>
        {props.patch}
      </div>
    );
  },
}));

const { DiffTabView } = await import("./diff-tab-view");

function renderDiffTabView({
  isMobile,
  defaultDiffMode,
}: {
  isMobile: boolean;
  defaultDiffMode: "unified" | "split";
}) {
  isMobileValue = isMobile;
  defaultDiffModeValue = defaultDiffMode;
  focusedDiffFileValue = "src/example.ts";
  capturedPatchDiffOptions = null;
  const { container } = render(<DiffTabView />);
  return container;
}

describe("DiffTabView mobile unified diff override", () => {
  test("mobile with split preference forces unified diff and shows an explanation", async () => {
    const container = renderDiffTabView({
      isMobile: true,
      defaultDiffMode: "split",
    });

    await act(async () => {});

    expect(container.textContent).toContain("Split view isn't available on small screens.");
    expect(capturedPatchDiffOptions?.diffStyle).toBe("unified");
  });
});

