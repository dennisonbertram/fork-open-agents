/**
 * POC 3a — mock cloud session stream server.
 *
 * Stands in for the real cloud session (apps/web/app/workflows/chat.ts writing
 * UIMessageChunks to a workflow Writable). It:
 *   - Authenticates the websocket upgrade against a known session token
 *     (mirrors Better Auth session verification — wrong/missing token => 401,
 *     the upgrade is rejected and the socket never opens).
 *   - Emits `diff-proposed` and `tool-call` (local_exec) messages on demand.
 *   - Receives and records the bridge's replies (diff-result, approval-request,
 *     output-available / denied / error) so the eval can assert end-to-end.
 */
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type IncomingMessage, type Server } from "node:http";
import {
  bridgeToServerSchema,
  type BridgeToServer,
  type ServerToBridge,
} from "./protocol";

export type MockCloud = {
  port: number;
  /** All messages received from the bridge, in order. */
  received: BridgeToServer[];
  /** Resolve when the bridge socket connects. */
  waitForConnection: () => Promise<void>;
  /** Send a message to the connected bridge. */
  send: (msg: ServerToBridge) => void;
  /** Wait for the next bridge message matching a predicate. */
  waitFor: <T extends BridgeToServer>(
    pred: (m: BridgeToServer) => m is T,
  ) => Promise<T>;
  close: () => Promise<void>;
};

export async function startMockCloud(validToken: string): Promise<MockCloud> {
  const received: BridgeToServer[] = [];
  const waiters: { pred: (m: BridgeToServer) => boolean; resolve: (m: BridgeToServer) => void }[] = [];
  let socket: WebSocket | null = null;
  let connectionResolve: (() => void) | null = null;
  const connectionPromise = new Promise<void>((res) => (connectionResolve = res));

  const httpServer: Server = createServer();

  // verifyClient enforces auth at the UPGRADE — no session, no socket.
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info: { req: IncomingMessage }, cb) => {
      const auth = info.req.headers["authorization"];
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token && token === validToken) {
        cb(true);
      } else {
        cb(false, 401, "Unauthorized");
      }
    },
  });

  wss.on("connection", (ws: WebSocket) => {
    socket = ws;
    connectionResolve?.();
    ws.on("message", (data) => {
      let msg: BridgeToServer;
      try {
        msg = bridgeToServerSchema.parse(JSON.parse(data.toString()));
      } catch {
        return;
      }
      received.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w && w.pred(msg)) {
          waiters.splice(i, 1);
          w.resolve(msg);
        }
      }
    });
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  return {
    port,
    received,
    waitForConnection: () => connectionPromise,
    send: (msg) => socket?.send(JSON.stringify(msg)),
    waitFor: <T extends BridgeToServer>(pred: (m: BridgeToServer) => m is T) =>
      new Promise<T>((resolve) => {
        const existing = received.find(pred);
        if (existing) {
          resolve(existing);
          return;
        }
        waiters.push({ pred, resolve: (m) => resolve(m as T) });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        socket?.close();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}
