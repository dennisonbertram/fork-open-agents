// POC 4b — meaningful eval harness.
//
// For each requested profile: spin up a CLEAN Linux container, run the profile
// through the runner (setup -> verify -> tool resolution), then run the tiny
// real program to prove the toolchain works. Capture a full transcript + the
// runner's pass/fail report + timings to evidence/.
//
// Usage:
//   bun run eval/run-eval.ts python go rust docker
//   bun run eval/run-eval.ts            # all four
//
// Docker base image is Ubuntu 24.04 (a realistic sandbox-like Linux base).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  dockerProfile,
  goProfile,
  pythonProfile,
  rustProfile,
} from "../profiles/index";
import type { ManagedRuntimeProfile } from "../profiles/types";
import { startDockerSession } from "../runner/docker-executor";
import { runProfile } from "../runner/runner";
import { PROGRAM_PROOFS } from "./programs";

const EVIDENCE_DIR = join(import.meta.dir, "..", "evidence");

// Per-profile base image. buildpack-deps:bookworm-curl ships curl +
// ca-certificates but NONE of the target runtimes (python/go/rust/docker) — a
// clean, realistic stand-in for a managed sandbox base that already has curl.
// The docker-in-sandbox profile uses a privileged debian base because dind
// needs a writable cgroup/devices environment.
const CURL_BASE = "buildpack-deps:bookworm-curl";
const DOCKER_BASE = "debian:bookworm";

const PROFILE_BY_KEY: Record<
  string,
  { profile: ManagedRuntimeProfile; image: string }
> = {
  python: { profile: pythonProfile, image: CURL_BASE },
  go: { profile: goProfile, image: CURL_BASE },
  rust: { profile: rustProfile, image: CURL_BASE },
  docker: { profile: dockerProfile, image: DOCKER_BASE },
};

type EvalOutcome = {
  profileId: string;
  baseImage: string;
  status: "passed" | "failed";
  setupDurationMs: number;
  verificationDurationMs: number;
  totalDurationMs: number;
  expectedToolsResolved: string;
  programProof: {
    ran: boolean;
    passed: boolean;
    marker: string;
    exitCode: number | null;
    output: string;
  };
  failureMessage: string | null;
};

async function evalProfile(
  key: string,
  profile: ManagedRuntimeProfile,
  image: string,
): Promise<EvalOutcome> {
  const privileged = profile.id === "docker-in-sandbox";
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    // biome-ignore lint: POC eval CLI output
    console.log(s);
  };

  log(`\n========== PROFILE: ${profile.id} (${profile.displayName}) ==========`);
  log(`base image: ${image}  privileged: ${privileged}`);

  const session = await startDockerSession({
    image,
    privileged,
  });
  log(`container: ${session.containerId}`);

  let outcome: EvalOutcome;
  try {
    const report = await runProfile(profile, session.exec);

    log("\n--- SETUP RESULTS ---");
    for (const r of report.setupResults) {
      log(
        `[${r.status}] ${r.commandId} (exit ${r.exitCode}, ${r.durationMs}ms)`,
      );
      log(r.summary);
    }
    log("\n--- VERIFICATION RESULTS ---");
    for (const r of report.verificationResults) {
      log(
        `[${r.status}] ${r.commandId} (required=${r.required}, exit ${r.exitCode}, ${r.durationMs}ms)`,
      );
      log(r.summary);
    }
    log("\n--- EXPECTED TOOLS ON PATH ---");
    for (const t of report.expectedTools) {
      log(`${t.resolved ? "OK " : "MISSING"} ${t.tool} -> ${t.path || "(not found)"}`);
    }
    log("\n--- OPTIONAL TOOLS ON PATH ---");
    for (const t of report.optionalTools) {
      log(`${t.resolved ? "OK " : "absent "} ${t.tool} -> ${t.path || "(not found)"}`);
    }

    // "Actually ran a program" proof.
    const proof = PROGRAM_PROOFS.find((p) => p.profileId === profile.id);
    let programProof = {
      ran: false,
      passed: false,
      marker: proof?.expectedMarker ?? "",
      exitCode: null as number | null,
      output: "",
    };
    if (proof) {
      log(`\n--- PROGRAM PROOF (expect marker: ${proof.expectedMarker}) ---`);
      const result = await session.exec(proof.command);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const passed = result.success && output.includes(proof.expectedMarker);
      programProof = {
        ran: true,
        passed,
        marker: proof.expectedMarker,
        exitCode: result.exitCode,
        output,
      };
      log(`exit ${result.exitCode} passed=${passed}`);
      log(output);
    }

    log(`\n--- REPORT SUMMARY ---`);
    log(report.summary);
    log(`setup: ${report.setupDurationMs}ms  verify: ${report.verificationDurationMs}ms  total: ${report.totalDurationMs}ms`);
    if (report.failureMessage) {
      log(`failureMessage: ${report.failureMessage}`);
    }

    outcome = {
      profileId: profile.id,
      baseImage: image,
      status: report.status,
      setupDurationMs: report.setupDurationMs,
      verificationDurationMs: report.verificationDurationMs,
      totalDurationMs: report.totalDurationMs,
      expectedToolsResolved: `${report.expectedTools.filter((t) => t.resolved).length}/${report.expectedTools.length}`,
      programProof,
      failureMessage: report.failureMessage,
    };

    // Persist the structured run report (mirrors a managedRuntimeProfileRuns row).
    writeFileSync(
      join(EVIDENCE_DIR, `${key}-report.json`),
      JSON.stringify({ ...report, programProof }, null, 2),
    );
  } finally {
    await session.cleanup();
    log(`\ncontainer ${session.containerId} removed`);
  }

  writeFileSync(join(EVIDENCE_DIR, `${key}-transcript.txt`), lines.join("\n"));
  return outcome;
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const docker = await import("../runner/docker-executor")
    .then(() => true)
    .catch(() => false);
  if (!docker) {
    throw new Error("docker-executor unavailable");
  }

  const requested = process.argv.slice(2);
  const keys = requested.length > 0 ? requested : ["python", "go", "rust", "docker"];

  const outcomes: EvalOutcome[] = [];
  for (const key of keys) {
    const entry = PROFILE_BY_KEY[key];
    if (!entry) {
      // biome-ignore lint: POC eval CLI output
      console.error(`Unknown profile key: ${key}`);
      continue;
    }
    try {
      outcomes.push(await evalProfile(key, entry.profile, entry.image));
    } catch (err) {
      // biome-ignore lint: POC eval CLI output
      console.error(`Eval failed for ${key}:`, err);
      outcomes.push({
        profileId: entry.profile.id,
        baseImage: entry.image,
        status: "failed",
        setupDurationMs: 0,
        verificationDurationMs: 0,
        totalDurationMs: 0,
        expectedToolsResolved: "0/0",
        programProof: { ran: false, passed: false, marker: "", exitCode: null, output: String(err) },
        failureMessage: String(err),
      });
    }
  }

  writeFileSync(
    join(EVIDENCE_DIR, "summary.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), outcomes }, null, 2),
  );

  // biome-ignore lint: POC eval CLI output
  console.log("\n\n================ EVAL SUMMARY ================");
  for (const o of outcomes) {
    // biome-ignore lint: POC eval CLI output
    console.log(
      `${o.profileId}: ${o.status} | tools ${o.expectedToolsResolved} | program ${o.programProof.passed ? "RAN OK" : o.programProof.ran ? "FAILED" : "n/a"} | setup ${o.setupDurationMs}ms total ${o.totalDurationMs}ms${o.failureMessage ? ` | ${o.failureMessage}` : ""}`,
    );
  }
}

main();
