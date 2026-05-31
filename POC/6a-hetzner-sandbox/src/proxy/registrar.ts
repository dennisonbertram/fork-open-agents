/**
 * ProxyRegistrar — registers/removes per-(sandbox,port) routes on the wildcard
 * reverse proxy that turns an internal port into a public URL.
 *
 * This is the genuinely novel piece vs Vercel: Vercel hands you a `*.vercel.run`
 * URL from their managed edge. Self-hosted, we run our own wildcard proxy
 * (Caddy) and program it at runtime.
 *
 * Routing scheme (mirrors RESEARCH.md §3):
 *   <sandbox-id>-<port>.<WILDCARD_BASE>  ->  <backendAddress>
 * e.g. abc123-3000.lvh.me  ->  sbx-abc123:3000
 *
 * Production uses Caddy's admin API with DNS-01 wildcard TLS; here we use the
 * same admin API over plain HTTP against a Caddy *container*.
 */

export interface ProxyRoute {
  /** Full host that clients hit, e.g. "abc123-3000.lvh.me". */
  host: string;
  /** Internal backend the proxy dials, e.g. "sbx-abc123:3000". */
  backendAddress: string;
}

export interface ProxyRegistrar {
  register(route: ProxyRoute): Promise<void>;
  remove(host: string): Promise<void>;
  /** List currently-registered hosts (used by tests/diagnostics). */
  list(): Promise<string[]>;
}

/**
 * CaddyRegistrar drives the Caddy admin API (default :2019) to add/remove
 * routes in the running "srv0" HTTP server without a restart.
 *
 * Each route is a Caddy route object matched by Host header, proxying to the
 * sandbox backend. Routes carry an `@id` equal to the host so they can be
 * deleted individually via `DELETE /id/<host>`.
 */
export class CaddyRegistrar implements ProxyRegistrar {
  constructor(private readonly adminBase: string) {}

  async register(route: ProxyRoute): Promise<void> {
    // Remove any stale route for this host first (idempotent register).
    await this.remove(route.host).catch(() => {});

    const routeObject = {
      "@id": route.host,
      match: [{ host: [route.host] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: route.backendAddress }],
        },
      ],
      terminal: true,
    };

    const res = await fetch(
      `${this.adminBase}/config/apps/http/servers/srv0/routes/...`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // POST to a path ending in /... appends to the array.
        body: JSON.stringify([routeObject]),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Caddy register failed: ${res.status} ${await res.text()}`,
      );
    }
  }

  async remove(host: string): Promise<void> {
    const res = await fetch(`${this.adminBase}/id/${host}`, {
      method: "DELETE",
    });
    // 200 = removed, 404/500-with-unknown-id = nothing to remove.
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      if (!body.includes("unknown object")) {
        throw new Error(`Caddy remove failed: ${res.status} ${body}`);
      }
    }
  }

  async list(): Promise<string[]> {
    const res = await fetch(
      `${this.adminBase}/config/apps/http/servers/srv0/routes`,
    );
    if (!res.ok) return [];
    const routes = (await res.json()) as Array<{ "@id"?: string }>;
    return routes
      .map((r) => r["@id"])
      .filter((id): id is string => typeof id === "string");
  }
}

/** No-op registrar for unit tests / driver-only paths. */
export class NoopRegistrar implements ProxyRegistrar {
  private hosts = new Set<string>();
  async register(route: ProxyRoute): Promise<void> {
    this.hosts.add(route.host);
  }
  async remove(host: string): Promise<void> {
    this.hosts.delete(host);
  }
  async list(): Promise<string[]> {
    return [...this.hosts];
  }
}
