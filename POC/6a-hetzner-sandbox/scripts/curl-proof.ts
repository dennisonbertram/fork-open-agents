/**
 * Standalone wildcard-URL proof using the system `curl` (not fetch), to make
 * the Caddy routing evidence reproducible and independent of the test runner.
 * Boots one sandbox, serves unique content on :3000, exposes it, then curls
 * http://<id>-3000.lvh.me:<port>/ and records the raw curl output.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { LocalDockerDriver } from "../src/drivers/local-docker-driver";
import { CaddyRegistrar } from "../src/proxy/registrar";
import { ensureNetwork, startCaddy, stopCaddy } from "../src/proxy/caddy-container";
import { connectHetzner } from "../src/connect";

const NETWORK = "poc-hetzner-net";
const WILDCARD_BASE = "lvh.me";
const PROXY_HOST_PORT = 8088;
const ADMIN_HOST_PORT = 2019;
const EVIDENCE = new URL("../evidence/", import.meta.url).pathname;

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  await ensureNetwork(NETWORK);
  const caddy = await startCaddy({
    network: NETWORK,
    proxyHostPort: PROXY_HOST_PORT,
    adminHostPort: ADMIN_HOST_PORT,
  });
  const registrar = new CaddyRegistrar(caddy.adminBase);
  const driver = new LocalDockerDriver({ image: "python:3.12-slim", network: NETWORK });
  const lines: string[] = [];

  try {
    const sb = await connectHetzner({
      driver,
      registrar,
      wildcardBase: WILDCARD_BASE,
      proxyScheme: "http",
      proxyPort: PROXY_HOST_PORT,
      sandboxId: "curlproof",
      timeout: 600_000,
    });
    const marker = `CURL-PROOF-${Date.now()}`;
    await sb.writeFile("/workspace/index.html", marker, "utf-8");
    await sb.execDetached("python3 -m http.server 3000", "/workspace");
    const url = await sb.exposePort(3000);

    // Give the in-container server a moment, then curl.
    await new Promise((r) => setTimeout(r, 1500));
    const target = `${url}/index.html`;
    lines.push(`$ curl -sS -D - ${target}`);
    const res = spawnSync("curl", ["-sS", "-D", "-", target], {
      encoding: "utf-8",
    });
    lines.push(res.stdout);
    if (res.stderr) lines.push("STDERR: " + res.stderr);
    lines.push(`expected marker present: ${res.stdout.includes(marker)}`);

    // Also show registered routes from Caddy.
    const routes = await registrar.list();
    lines.push(`caddy routes: ${JSON.stringify(routes)}`);

    await sb.stop();
    const removed = await registrar.list();
    lines.push(`caddy routes after stop(): ${JSON.stringify(removed)}`);

    const out = lines.join("\n") + "\n";
    writeFileSync(`${EVIDENCE}caddy-wildcard-curl-proof.txt`, out);
    console.log(out);
  } finally {
    await stopCaddy(caddy.containerName).catch(() => {});
    await driver
      .destroy({ id: "sbx-curlproof", internalHost: "sbx-curlproof" })
      .catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
