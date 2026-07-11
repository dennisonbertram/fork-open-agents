export type SessionDialogRepository = { owner: string; repo: string };

export type SessionDialogRepositoryEvent =
  | { type: "open"; repository?: SessionDialogRepository }
  | { type: "close" };

export function nextSessionDialogRepository(
  _current: SessionDialogRepository | null,
  event: SessionDialogRepositoryEvent,
): SessionDialogRepository | null {
  return event.type === "open" ? (event.repository ?? null) : null;
}
