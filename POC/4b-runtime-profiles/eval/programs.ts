// POC 4b — "actually ran a program" proofs per runtime.
//
// Each entry writes a tiny real source file inside the environment, builds/runs
// it with the freshly-installed toolchain, and asserts the expected output.
// This proves the toolchain WORKS end-to-end, not just that the binary exists.

export type ProgramProof = {
  profileId: string;
  // A single shell command that creates, builds, and runs a tiny program and
  // prints a known marker on success.
  command: string;
  // Substring that must appear in stdout for the proof to count as passed.
  expectedMarker: string;
};

const PYTHON_PROOF = [
  "set -e",
  "mkdir -p /tmp/oa-py && cd /tmp/oa-py",
  `printf 'import sys\\nprint("PYTHON_OK", sys.version_info.major, sys.version_info.minor)\\n' > hello.py`,
  "python hello.py",
].join("\n");

const GO_PROOF = [
  "set -e",
  "mkdir -p /tmp/oa-go && cd /tmp/oa-go",
  "go mod init oa-go >/dev/null 2>&1 || true",
  `printf 'package main\\nimport "fmt"\\nfunc main() { fmt.Println("GO_OK") }\\n' > main.go`,
  // Compile + run, proving the compiler toolchain works.
  "go run main.go",
].join("\n");

const RUST_PROOF = [
  "set -e",
  "cd /tmp",
  "rm -rf oa-rust",
  "cargo new --bin oa-rust >/dev/null 2>&1",
  "cd oa-rust",
  `printf 'fn main() { println!("RUST_OK"); }\\n' > src/main.rs`,
  // cargo run compiles and executes, proving the full build pipeline works.
  "cargo run --quiet",
].join("\n");

const DOCKER_PROOF = [
  "set -e",
  // Proves the daemon can pull and run a container end-to-end. Only succeeds in
  // a privileged/dind-capable environment.
  "docker run --rm hello-world | grep -q 'Hello from Docker' && echo DOCKER_OK",
].join("\n");

export const PROGRAM_PROOFS: ProgramProof[] = [
  { profileId: "python-uv", command: PYTHON_PROOF, expectedMarker: "PYTHON_OK" },
  { profileId: "go-toolchain", command: GO_PROOF, expectedMarker: "GO_OK" },
  { profileId: "rust-cargo", command: RUST_PROOF, expectedMarker: "RUST_OK" },
  {
    profileId: "docker-in-sandbox",
    command: DOCKER_PROOF,
    expectedMarker: "DOCKER_OK",
  },
];
