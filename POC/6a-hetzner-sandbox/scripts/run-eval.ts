/**
 * Measurement harness: characterizes the Docker driver's create->exec-ready and
 * snapshot+restore timings, and produces a wildcard-URL proof, writing evidence
 * to evidence/. These are DOCKER numbers (the local eval stand-in); the
 * production targets are Firecracker's <125ms boot / 3-28ms restore (RESEARCH.md).
 *
 * Run: `bun run scripts/run-eval.ts`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LocalDockerDriver } from "../src/drivers/local-docker-driver";
import { CaddyRegistrar } from "../src/proxy/registrar";
import { ensureNetwork, startCaddy, stopCaddy } from "../src/proxy/caddy-container";
import { connectHetzner } from "../src/connect";

const NETWORK = "poc-hetzner-net";
const WILDCARD_BASE = "lvh.me";
const PROXY_HOST_PORT = 8088;
const ADMIN_HOST_PORT = 2019;
const IMAGE = "python:3.12-slim";
const EVIDENCE = new URL("../evidence/", import.meta.url).pathname;

function now() {
  return performance.now();
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const log: string[] = [];
  const say = (s: string) => {
    console.log(s);
    log.push(s);
  };

  await ensureNetwork(NETWORK);
  const caddy = await startCaddy({
    network: NETWORK,
    proxyHostPort: PROXY_HOST_PORT,
    adminHostPort: ADMIN_HOST_PORT,
  });
  const registrar = new CaddyRegistrar(caddy.adminBase);
  const driver = new LocalDockerDriver({ image: IMAGE, network: NETWORK });

  const metrics: Record<string, number> = {};

  try {
    // --- create -> exec-ready ---
    const t0 = now();
    const sb = await connectHetzner({
      driver,
      registrar,
      wildcardBase: WILDCARD_BASE,
      proxyScheme: "http",
      proxyPort: PROXY_HOST_PORT,
      sandboxId: "measure",
      timeout: 600_000,
    });
    const tCreated = now();
    await sb.exec("true", "/workspace", 30_000);
    const tExecReady = now();
    metrics.create_ms = Math.round(tCreated - t0);
    metrics.create_to_exec_ready_ms = Math.round(tExecReady - t0);
    say(`[create] container create: ${metrics.create_ms} ms`);
    say(`[create] create -> exec-ready: ${metrics.create_to_exec_ready_ms} ms`);

    // --- wildcard URL proof ---
    await sb.writeFile("/workspace/index.html", "MEASURE-PROOF-OK", "utf-8");
    await sb.execDetached("python3 -m http.server 3000", "/workspace");
    const url = await sb.exposePort(3000);
    let body = "";
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`${url}/index.html`);
        if (res.ok) {
          body = await res.text();
          break;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const proofOk = body.includes("MEASURE-PROOF-OK");
    say(`[proxy] GET ${url}/index.html -> ${proofOk ? "OK" : "FAIL"} (body: ${body.trim()})`);

    // --- snapshot + restore timing + hash match ---
    const payload = "measure-survivor-" + "z".repeat(2000);
    await sb.writeFile("/workspace/data.bin", payload, "utf-8");
    const hashBefore = createHash("sha256").update(payload).digest("hex");

    const tSnap0 = now();
    const { snapshotId } = await sb.snapshot();
    const tSnap1 = now();
    metrics.snapshot_ms = Math.round(tSnap1 - tSnap0);
    say(`[snapshot] snapshot(): ${metrics.snapshot_ms} ms (id=${snapshotId})`);

    const tRes0 = now();
    await sb.restore(600_000);
    const tRes1 = now();
    metrics.restore_ms = Math.round(tRes1 - tRes0);
    say(`[restore] restore(): ${metrics.restore_ms} ms`);

    const restored = await sb.readFile("/workspace/data.bin", "utf-8");
    const hashAfter = createHash("sha256").update(restored).digest("hex");
    const hashMatch = hashAfter === hashBefore;
    say(`[snapshot] hash before: ${hashBefore.slice(0, 16)}...`);
    say(`[snapshot] hash after : ${hashAfter.slice(0, 16)}...`);
    say(`[snapshot] HASH MATCH: ${hashMatch}`);

    await sb.stop();

    const summary = {
      timestamp: new Date().toISOString(),
      driver: "local-docker",
      image: IMAGE,
      wildcard_url_proof: { url, ok: proofOk, body: body.trim() },
      snapshot_hash_match: hashMatch,
      hash_before: hashBefore,
      hash_after: hashAfter,
      metrics_ms: metrics,
      production_targets_firecracker: {
        boot_ms: "<=125",
        snapshot_restore_ms: "3-28",
        note: "Docker numbers above are the local eval stand-in; Firecracker is the production target (RESEARCH.md §1B/§4).",
      },
    };
    writeFileSync(
      `${EVIDENCE}measurements.json`,
      JSON.stringify(summary, null, 2),
    );
    writeFileSync(`${EVIDENCE}measure-run.log`, log.join("\n") + "\n");
    say(`\nEvidence written to evidence/measurements.json and evidence/measure-run.log`);

    if (!proofOk || !hashMatch) {
      process.exitCode = 1;
    }
  } finally {
    await stopCaddy(caddy.containerName).catch(() => {});
    // GC any leftover sandbox containers.
    await driver.destroy({ id: "sbx-measure", internalHost: "sbx-measure" }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
