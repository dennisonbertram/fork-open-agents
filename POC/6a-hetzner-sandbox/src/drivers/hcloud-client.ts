/**
 * Thin typed wrapper around the Hetzner Cloud REST API (v1).
 * https://docs.hetzner.cloud/reference/cloud
 *
 * Only the endpoints the driver needs are implemented. Auth is a bearer token
 * read from HCLOUD_TOKEN. The client surfaces 429 rate-limit handling
 * (RESEARCH.md §8: 3600 req/hr) with a single bounded retry.
 */

export interface HcloudServer {
  id: number;
  name: string;
  status: string; // "initializing" | "starting" | "running" | ...
  public_net: {
    ipv4: { ip: string } | null;
  };
  private_net: Array<{ ip: string }>;
}

export interface CreateServerRequest {
  name: string;
  server_type: string;
  image: string;
  location?: string;
  ssh_keys?: Array<string | number>;
  user_data?: string;
  labels?: Record<string, string>;
  start_after_create?: boolean;
}

export interface HcloudAction {
  id: number;
  status: string; // "running" | "success" | "error"
  progress: number;
  resources?: Array<{ id: number; type: string }>;
}

export class HcloudClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://api.hetzner.cloud/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const doFetch = () =>
      this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await doFetch();
    if (res.status === 429) {
      // Respect RateLimit-Reset if present, else back off 1s, retry once.
      const reset = Number(res.headers.get("RateLimit-Reset"));
      const waitMs = Number.isFinite(reset)
        ? Math.max(0, reset * 1000 - Date.now())
        : 1000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5000)));
      res = await doFetch();
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`hcloud ${method} ${path} -> ${res.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createServer(
    req: CreateServerRequest,
  ): Promise<{ server: HcloudServer; action: HcloudAction }> {
    return this.request("POST", "/servers", req);
  }

  async getServer(id: number): Promise<{ server: HcloudServer }> {
    return this.request("GET", `/servers/${id}`);
  }

  async deleteServer(id: number): Promise<{ action: HcloudAction }> {
    return this.request("DELETE", `/servers/${id}`);
  }

  /** Create a disk image (snapshot) from a server. */
  async createImage(
    serverId: number,
    description: string,
  ): Promise<{ image: { id: number }; action: HcloudAction }> {
    return this.request("POST", `/servers/${serverId}/actions/create_image`, {
      type: "snapshot",
      description,
    });
  }

  async getAction(id: number): Promise<{ action: HcloudAction }> {
    return this.request("GET", `/actions/${id}`);
  }

  async createSshKey(
    name: string,
    publicKey: string,
  ): Promise<{ ssh_key: { id: number } }> {
    return this.request("POST", "/ssh_keys", {
      name,
      public_key: publicKey,
    });
  }
}
