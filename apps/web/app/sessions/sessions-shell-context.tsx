"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { SessionDialogRepository } from "./session-dialog-repository";

type SessionsShellContextValue = {
  openNewSessionDialog: (repository?: SessionDialogRepository) => void;
  activeSessionCount: number;
};

const SessionsShellContext = createContext<
  SessionsShellContextValue | undefined
>(undefined);

export function SessionsShellProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SessionsShellContextValue;
}) {
  return (
    <SessionsShellContext.Provider value={value}>
      {children}
    </SessionsShellContext.Provider>
  );
}

export function useSessionsShell() {
  const context = useContext(SessionsShellContext);

  if (!context) {
    throw new Error(
      "useSessionsShell must be used within SessionsShellProvider",
    );
  }

  return context;
}
