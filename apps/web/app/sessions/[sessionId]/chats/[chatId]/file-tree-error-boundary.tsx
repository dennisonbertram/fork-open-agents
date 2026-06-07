"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage: string | null;
};

/**
 * Local error boundary that wraps <FileTree> so a tree-builder failure
 * (e.g. @pierre/trees "Duplicate path" from unexpected git output) degrades
 * gracefully to an inline message instead of letting the error bubble up to
 * the route-level error.tsx and taking down the whole chat workspace.
 */
export class FileTreeErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error(
      "[FileTree] render error — tree degraded gracefully",
      error,
      info,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
          <p className="text-xs text-muted-foreground">
            Couldn&apos;t render files
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
