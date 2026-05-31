import { describe, expect, test } from "bun:test";
import {
  buildCloudInit,
  HcloudDriver,
} from "../src/drivers/hcloud-driver";

/**
 * Mock hcloud API test.
 *
 * Spins up a tiny in-process HTTP server that emulates the subset of the
 * Hetzner Cloud API the driver uses, captures every request, and asserts:
 *  - the exact create-server payload (image, server_type, location, ssh_keys,
 *    user_data/cloud-init)
 *  - the poll-until-running loop (server reports initializing -> running)
 *  - snapshot image creation + action polling
 *  - delete-on-stop
 *
 * SSH is stubbed by overriding the driver's private `ssh` via a subclass so the
 * test never shells out (no live VM). This validates the control-plane API
 * choreography, which is what cannot be verified without a real token.
 */

interface CapturedRequest {
  method: string;
  path: string;
  body: unknown;
}

function startMockHcloud(): Promise<{
  baseUrl: string;
  requests: CapturedRequest[];
  stop: () => void;
  fetchImpl: typeof fetch;
}> {
  const requests: CapturedRequest[] = [];
  let serverStatusCalls = 0;
  let actionStatusCalls = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;
      let body: unknown;
      if (method === "POST") {
        body = await req.json().catch(() => undefined);
      }
      requests.push({ method, path, body });

      // POST /servers -> created, status initializing, with a create action.
      if (method === "POST" && path === "/v1/servers") {
        return Response.json({
          server: {
            id: 4242,
            name: (body as { name: string }).name,
            status: "initializing",
            public_net: { ipv4: { ip: "203.0.113.10" } },
            private_net: [{ ip: "10.0.0.5" }],
          },
          action: { id: 9001, status: "running", progress: 0 },
        });
      }

      // GET /actions/:id -> success after first poll (proves polling loop).
      if (method === "GET" && path.startsWith("/v1/actions/")) {
        actionStatusCalls++;
        return Response.json({
          action: {
            id: Number(path.split("/").pop()),
            status: actionStatusCalls >= 1 ? "success" : "running",
            progress: 100,
          },
        });
      }

      // GET /servers/:id -> initializing first, then running (proves the loop).
      if (method === "GET" && path.startsWith("/v1/servers/")) {
        serverStatusCalls++;
        return Response.json({
          server: {
            id: 4242,
            name: "sbx-test",
            status: serverStatusCalls >= 2 ? "running" : "initializing",
            public_net: { ipv4: { ip: "203.0.113.10" } },
            private_net: [{ ip: "10.0.0.5" }],
          },
        });
      }

      // POST /servers/:id/actions/create_image -> image + action.
      if (method === "POST" && path.endsWith("/actions/create_image")) {
        return Response.json({
          image: { id: 77, description: (body as { description: string }).description },
          action: { id: 9100, status: "success", progress: 100 },
        });
      }

      // DELETE /servers/:id -> delete action.
      if (method === "DELETE" && path.startsWith("/v1/servers/")) {
        return Response.json({ action: { id: 9200, status: "success", progress: 100 } });
      }

      return new Response("not found", { status: 404 });
    },
  });

  const baseUrl = `http://127.0.0.1:${server.port}/v1`;
  return Promise.resolve({
    baseUrl,
    requests,
    stop: () => server.stop(true),
    fetchImpl: fetch,
  });
}

/** Driver subclass that stubs SSH so we test API choreography only. */
class StubbedSshHcloudDriver extends HcloudDriver {
  protected override ssh() {
    return Promise.resolve({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });
  }
}

describe("HcloudDriver against mock hcloud API", () => {
  test("create issues correct payload and polls until running", async () => {
    const mock = await startMockHcloud();
    try {
      const driver = new StubbedSshHcloudDriver({
        token: "tok_test",
        baseUrl: mock.baseUrl,
        image: "ubuntu-24.04",
        serverType: "cax11",
        location: "fsn1",
        sshKeys: ["my-key"],
        sshPublicKey: "ssh-ed25519 AAAATESTKEY agent@poc",
        pollIntervalMs: 5,
        readyTimeoutMs: 5000,
      });

      const handle = await driver.create({
        sandboxId: "test",
        workingDirectory: "/workspace",
        env: { FOO: "bar" },
      });

      expect(handle.id).toBe("4242");
      expect(handle.internalHost).toBe("203.0.113.10");

      const createReq = mock.requests.find(
        (r) => r.method === "POST" && r.path === "/v1/servers",
      );
      expect(createReq).toBeDefined();
      const payload = createReq!.body as Record<string, unknown>;
      expect(payload.name).toBe("sbx-test");
      expect(payload.server_type).toBe("cax11");
      expect(payload.image).toBe("ubuntu-24.04");
      expect(payload.location).toBe("fsn1");
      expect(payload.ssh_keys).toEqual(["my-key"]);
      expect(payload.start_after_create).toBe(true);
      expect((payload.labels as Record<string, string>)["sandbox-id"]).toBe("test");

      // cloud-init user_data must contain the injected SSH key + readiness marker.
      const userData = payload.user_data as string;
      expect(userData).toContain("#cloud-config");
      expect(userData).toContain("ssh-ed25519 AAAATESTKEY agent@poc");
      expect(userData).toContain("/run/sandbox-ready");
      expect(userData).toContain("/workspace");

      // Polling loop hit GET /servers/:id at least twice (init -> running).
      const serverPolls = mock.requests.filter(
        (r) => r.method === "GET" && r.path.startsWith("/v1/servers/"),
      );
      expect(serverPolls.length).toBeGreaterThanOrEqual(2);
    } finally {
      mock.stop();
    }
  });

  test("snapshot creates an image and polls the action", async () => {
    const mock = await startMockHcloud();
    try {
      const driver = new StubbedSshHcloudDriver({
        token: "tok_test",
        baseUrl: mock.baseUrl,
        sshPublicKey: "ssh-ed25519 KEY a@b",
        pollIntervalMs: 5,
        readyTimeoutMs: 5000,
      });
      const handle = await driver.create({
        sandboxId: "test",
        workingDirectory: "/workspace",
      });
      const { snapshotId } = await driver.snapshot(handle);
      expect(snapshotId).toBe("77");

      const imgReq = mock.requests.find((r) =>
        r.path.endsWith("/actions/create_image"),
      );
      expect(imgReq).toBeDefined();
      expect((imgReq!.body as { type: string }).type).toBe("snapshot");
    } finally {
      mock.stop();
    }
  });

  test("destroy DELETEs the server (ends billing)", async () => {
    const mock = await startMockHcloud();
    try {
      const driver = new StubbedSshHcloudDriver({
        token: "tok_test",
        baseUrl: mock.baseUrl,
        sshPublicKey: "ssh-ed25519 KEY a@b",
        pollIntervalMs: 5,
        readyTimeoutMs: 5000,
      });
      const handle = await driver.create({
        sandboxId: "test",
        workingDirectory: "/workspace",
      });
      await driver.destroy(handle);
      const del = mock.requests.find(
        (r) => r.method === "DELETE" && r.path.startsWith("/v1/servers/"),
      );
      expect(del).toBeDefined();
      expect(del!.path).toBe("/v1/servers/4242");
    } finally {
      mock.stop();
    }
  });

  test("rejects when no token provided", () => {
    expect(() => new HcloudDriver({ token: "" })).toThrow();
  });

  test("buildCloudInit emits valid cloud-config with key + marker", () => {
    const ci = buildCloudInit({
      user: "sandbox",
      sshPublicKey: "ssh-ed25519 ABC test",
      workingDirectory: "/workspace",
    });
    expect(ci.startsWith("#cloud-config")).toBe(true);
    expect(ci).toContain("name: sandbox");
    expect(ci).toContain("ssh-ed25519 ABC test");
    expect(ci).toContain("touch /run/sandbox-ready");
  });
});
