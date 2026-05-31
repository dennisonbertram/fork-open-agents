#!/usr/bin/env bash
# Remove all POC Docker resources (sandbox containers, Caddy, snapshot images).
set -euo pipefail
docker ps -aq --filter "label=poc-hetzner-sandbox=true" | xargs -r docker rm -f
docker rm -f poc-caddy 2>/dev/null || true
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^poc-snap-' | xargs -r docker rmi -f || true
docker network rm poc-hetzner-net 2>/dev/null || true
echo "POC Docker resources cleaned."
