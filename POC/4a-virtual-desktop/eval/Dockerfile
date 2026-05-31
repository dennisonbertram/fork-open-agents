# Faithful reproduction of the Vercel Sandbox runtime: Amazon Linux 2023,
# x86_64 (Firecracker microVMs are x86_64), dnf package manager, a non-root
# user with sudo (mirrors the `vercel-sandbox` user).
#
# Build with:  docker build --platform linux/amd64 -t poc4a-desktop -f eval/Dockerfile .
FROM amazonlinux:2023

# sudo + bash so the profile setup.sh runs exactly as it would in the sandbox.
# Note: AL2023 ships curl-minimal preinstalled; installing full `curl` conflicts
# with it, so we rely on the preinstalled curl (curl-minimal provides /bin/curl).
RUN dnf -y install sudo bash shadow-utils which procps-ng && dnf clean all

# Mirror the sandbox user model: non-root user with passwordless sudo.
RUN useradd -m -s /bin/bash sandbox \
  && echo 'sandbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/sandbox \
  && chmod 0440 /etc/sudoers.d/sandbox

USER sandbox
WORKDIR /home/sandbox/poc

# Bring in the profile setup, the startup script, and the eval harness.
COPY --chown=sandbox:sandbox profile/setup.sh ./profile/setup.sh
COPY --chown=sandbox:sandbox scripts/start-desktop.sh ./scripts/start-desktop.sh
COPY --chown=sandbox:sandbox eval/ ./eval/

RUN chmod +x ./profile/setup.sh ./scripts/start-desktop.sh ./eval/*.sh 2>/dev/null || true

# Run the profile's setup commands at build time, timing the install.
# A BuildKit cache mount for dnf keeps downloaded RPMs/metadata across rebuilds
# so iterating on the eval doesn't re-pay the full emulated download each time.
RUN --mount=type=cache,target=/var/cache/dnf,sharing=locked,uid=1000,gid=1000 \
  --mount=type=cache,target=/var/cache/libdnf5,sharing=locked,uid=1000,gid=1000 \
  bash -lc 'set -e; \
  start=$(date +%s); \
  bash ./profile/setup.sh; \
  end=$(date +%s); \
  echo "SETUP_SECONDS=$((end-start))" | tee /home/sandbox/poc/setup-timing.txt'

ENV DISPLAY=:99 \
    NOVNC_PORT=6080 \
    VNC_PORT=5900 \
    SCREEN_GEOMETRY=1280x800x24

EXPOSE 6080

# The eval entrypoint stands up the desktop and runs all assertions.
CMD ["bash", "./eval/run-eval.sh"]
