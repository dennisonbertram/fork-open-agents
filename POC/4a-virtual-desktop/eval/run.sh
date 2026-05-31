#!/usr/bin/env bash
# run.sh — host-side orchestrator. Builds the AL2023 image (which runs the
# profile setup.sh), runs the eval inside the container, and copies evidence out.
set -euo pipefail

cd "$(dirname "$0")/.."        # -> POC/4a-virtual-desktop
ROOT="$(pwd)"
IMAGE="poc4a-desktop"
EV="$ROOT/evidence"
mkdir -p "$EV"

echo "[run] building image (Amazon Linux 2023, linux/amd64) — runs profile setup.sh"
# Plain progress so the emulated dnf output streams line-by-line (the default
# TUI progress buffers per-step, which hides progress under slow emulation).
export DOCKER_BUILDKIT=1
build_start=$(date +%s)
docker build --progress=plain --platform linux/amd64 -t "$IMAGE" -f eval/Dockerfile . 2>&1 \
  | tee "$EV/docker-build.log"
build_end=$(date +%s)
echo "BUILD_SECONDS=$((build_end-build_start))" | tee "$EV/build-timing.txt"

echo "[run] running eval container"
cid=$(docker create --platform linux/amd64 -p 6080:6080 "$IMAGE")
docker start -a "$cid" 2>&1 | tee "$EV/eval-run.log"
rc=${PIPESTATUS[0]}

echo "[run] copying evidence out of container"
docker cp "$cid:/home/sandbox/poc/evidence/." "$EV/" 2>/dev/null || true
docker rm -f "$cid" >/dev/null 2>&1 || true

echo "[run] eval exit code: $rc"
echo "[run] evidence in: $EV"
ls -la "$EV"
exit "$rc"
