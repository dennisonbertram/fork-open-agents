"use client";

import { createContext, useContext } from "react";

export type WorkspaceSettingsTarget = {
  owner: string;
  repo: string;
  label: string;
};

type WorkspaceSettingsContextValue = {
  /** The repo whose workspace settings are open in-content, or null. */
  target: WorkspaceSettingsTarget | null;
  openWorkspaceSettings: (target: WorkspaceSettingsTarget) => void;
  closeWorkspaceSettings: () => void;
};

const WorkspaceSettingsContext =
  createContext<WorkspaceSettingsContextValue | null>(null);

export const WorkspaceSettingsProvider = WorkspaceSettingsContext.Provider;

export function useWorkspaceSettings(): WorkspaceSettingsContextValue {
  const value = useContext(WorkspaceSettingsContext);
  if (!value) {
    throw new Error(
      "useWorkspaceSettings must be used within a WorkspaceSettingsProvider",
    );
  }
  return value;
}
