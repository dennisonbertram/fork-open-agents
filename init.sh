#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ENV_FILE="$ROOT_DIR/apps/web/.env.local"
WEB_ENV_EXAMPLE="$ROOT_DIR/apps/web/.env.example"
ENVIRONMENT="${INIT_ENVIRONMENT:-development}"
LOCAL_URL="${LOCAL_URL:-http://localhost:3000}"

OFFLINE=0
FORCE_ENV_PULL=0
VERIFY=0
CI_MODE=0
SKIP_INSTALL=0
SKIP_CHECKS=0
LINK_VERCEL=0
VERCEL_PROJECT="${VERCEL_PROJECT:-}"
VERCEL_TEAM="${VERCEL_TEAM:-}"

usage() {
  cat <<'USAGE'
Usage: ./init.sh [options]

Sets up this checkout, worktree, sandbox, or VM for local Open Agents development.

Options:
  --offline                 Do not call Vercel. Create apps/web/.env.local from
                            apps/web/.env.example when it is missing.
  --environment <target>    Vercel env to pull: development or preview.
                            Default: development.
  --force-env-pull          Replace apps/web/.env.local from the selected
                            Vercel env.
  --verify                  Run typecheck and a temporary local server smoke.
  --ci                      Non-interactive mode. Fail on missing runnable env.
  --skip-install            Skip bun install --frozen-lockfile.
  --skip-checks             Skip typecheck, including when --verify is passed.
  --link-vercel             Link this checkout before pulling env. Requires
                            --vercel-project or VERCEL_PROJECT.
  --vercel-project <name>   Vercel project name or ID for --link-vercel.
  --vercel-team <team>      Vercel team slug or ID for --link-vercel.
  -h, --help                Show this help.

Examples:
  ./init.sh
  ./init.sh --environment preview
  ./init.sh --force-env-pull
  ./init.sh --verify
  ./init.sh --offline
  ./init.sh --link-vercel --vercel-project open-agents --vercel-team dennisons-projects
USAGE
}

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

ok() {
  printf '\033[1;32m✓\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --offline)
        OFFLINE=1
        shift
        ;;
      --environment)
        [[ $# -ge 2 ]] || die "--environment requires a value"
        case "$2" in
          development | preview)
            ENVIRONMENT="$2"
            ;;
          *)
            die "--environment must be development or preview"
            ;;
        esac
        shift 2
        ;;
      --force-env-pull)
        FORCE_ENV_PULL=1
        shift
        ;;
      --verify)
        VERIFY=1
        shift
        ;;
      --ci)
        CI_MODE=1
        shift
        ;;
      --skip-install)
        SKIP_INSTALL=1
        shift
        ;;
      --skip-checks)
        SKIP_CHECKS=1
        shift
        ;;
      --link-vercel)
        LINK_VERCEL=1
        shift
        ;;
      --vercel-project)
        [[ $# -ge 2 ]] || die "--vercel-project requires a value"
        VERCEL_PROJECT="$2"
        shift 2
        ;;
      --vercel-team)
        [[ $# -ge 2 ]] || die "--vercel-team requires a value"
        VERCEL_TEAM="$2"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1"
        ;;
    esac
  done
}

require_repo_root() {
  [[ -f "$ROOT_DIR/package.json" ]] || die "package.json not found at repo root"
  [[ -f "$ROOT_DIR/apps/web/package.json" ]] || die "apps/web/package.json not found"
  [[ -f "$WEB_ENV_EXAMPLE" ]] || die "apps/web/.env.example not found"
}

require_tools() {
  has_command git || die "git is required"
  has_command bun || die "bun is required. Install Bun, then rerun ./init.sh"

  if [[ "$OFFLINE" -eq 0 && ( "$FORCE_ENV_PULL" -eq 1 || ! -f "$WEB_ENV_FILE" || "$LINK_VERCEL" -eq 1 ) ]]; then
    has_command vercel || die "vercel CLI is required to pull Vercel env. Install it or rerun with --offline"
  fi

  if [[ "$VERIFY" -eq 1 ]]; then
    has_command curl || die "curl is required for --verify"
  fi
}

install_dependencies() {
  if [[ "$SKIP_INSTALL" -eq 1 ]]; then
    warn "skipping dependency install"
    return
  fi

  info "Installing dependencies"
  (cd "$ROOT_DIR" && bun install --frozen-lockfile)
  ok "dependencies installed"
}

install_git_hooks() {
  if [[ ! -d "$ROOT_DIR/.git" ]]; then
    return 0
  fi
  if [[ ! -d "$ROOT_DIR/.githooks" ]]; then
    return 0
  fi

  info "Installing git hooks"
  (cd "$ROOT_DIR" && git config core.hooksPath .githooks)
  ok "git hooks installed (pre-push runs check + typecheck; bypass with SKIP_HOOKS=1)"
}

link_vercel_if_requested() {
  if [[ "$OFFLINE" -ne 0 ]]; then
    return 0
  fi

  if [[ -f "$ROOT_DIR/.vercel/project.json" ]]; then
    ok "Vercel project link found"
    return
  fi

  if [[ "$LINK_VERCEL" -eq 0 ]]; then
    if [[ "$CI_MODE" -eq 1 || ! -t 0 || ! -t 1 ]]; then
      die "Vercel project is not linked. Rerun with --link-vercel --vercel-project <name>, or use --offline"
    fi

    info "Linking Vercel project interactively"
    (cd "$ROOT_DIR" && vercel link)
    ok "Vercel project linked"
    return
  fi

  [[ -n "$VERCEL_PROJECT" ]] || die "--link-vercel requires --vercel-project or VERCEL_PROJECT"

  info "Linking Vercel project"
  local args=(link --yes --project "$VERCEL_PROJECT")
  if [[ -n "$VERCEL_TEAM" ]]; then
    args+=(--scope "$VERCEL_TEAM")
  fi
  (cd "$ROOT_DIR" && vercel "${args[@]}")
  ok "Vercel project linked"
}

env_has_value() {
  local file="$1"
  local key="$2"

  awk -F= -v key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      name = $1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name == key) {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (value != "" && value != "\"\"" && value != "''") {
          found = 1
        }
      }
    }
    END { exit(found ? 0 : 1) }
  ' "$file"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  if grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$file"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { replaced = 0 }
      /^[[:space:]]*#/ { print; next }
      {
        line = $0
        split(line, parts, "=")
        name = parts[1]
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
        if (name == key && replaced == 0) {
          print key "=" value
          replaced = 1
          next
        }
        print
      }
    ' "$file" >"$tmp_file"
    mv "$tmp_file" "$file"
  else
    rm -f "$tmp_file"
    printf '\n%s=%s\n' "$key" "$value" >>"$file"
  fi
}

# Prints the database endpoint apps/web/.env.local targets. Only the endpoint
# host is shown -- never the connection string, which carries credentials.
# Exists because an existing .env.local is reused unchecked, so "which database
# am I about to write to?" is otherwise invisible until something goes wrong.
report_database_target() {
  local url endpoint
  url="$(grep -m1 '^POSTGRES_URL=' "$WEB_ENV_FILE" 2>/dev/null || true)"
  if [[ -z "$url" ]]; then
    warn "apps/web/.env.local has no POSTGRES_URL"
    return
  fi
  endpoint="$(printf '%s' "$url" | grep -o 'ep-[a-z0-9-]*' | head -1)"
  if [[ -z "$endpoint" ]]; then
    info "database target: (non-Neon or unrecognized host)"
    return
  fi
  info "database target: ${endpoint}"

  # PRODUCTION_DB_HOST arms the migration guard in apps/web/lib/db/migrate.ts.
  # It is present-but-empty in .env.example, so the offline skeleton path
  # produces a checkout where the guard silently fails open. Say so out loud --
  # a disarmed guard that nobody knows about is worse than no guard.
  local guard_host
  guard_host="$(grep -m1 '^PRODUCTION_DB_HOST=' "$WEB_ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  if [[ -z "${guard_host}" ]]; then
    guard_host="${PRODUCTION_DB_HOST:-}"
  fi

  if [[ -z "${guard_host}" ]]; then
    warn "PRODUCTION_DB_HOST is empty -- the migration guard is DISARMED; a production POSTGRES_URL here would not be refused"
    return
  fi

  if [[ "${guard_host}" == *"${endpoint%-pooler}"* ]]; then
    warn "this env targets the PRODUCTION database -- migrations and writes will hit live data"
  fi
}

ensure_better_auth_secret() {
  if [[ ! -f "$WEB_ENV_FILE" ]]; then
    return 0
  fi
  if env_has_value "$WEB_ENV_FILE" "BETTER_AUTH_SECRET"; then
    return
  fi

  has_command openssl || {
    warn "BETTER_AUTH_SECRET is missing and openssl is unavailable; add a strong secret manually"
    return
  }

  info "Generating local BETTER_AUTH_SECRET"
  set_env_value "$WEB_ENV_FILE" "BETTER_AUTH_SECRET" "$(openssl rand -base64 48)"
  chmod 600 "$WEB_ENV_FILE"
  ok "local BETTER_AUTH_SECRET generated"
}

create_env_skeleton() {
  if [[ -f "$WEB_ENV_FILE" ]]; then
    ok "local env file exists"
    return
  fi

  info "Creating local env skeleton"
  cp "$WEB_ENV_EXAMPLE" "$WEB_ENV_FILE"
  chmod 600 "$WEB_ENV_FILE"
  ensure_better_auth_secret
  warn "created $WEB_ENV_FILE from .env.example; fill missing service credentials before running the full app"
}

# Resolves apps/web/.env.local by whichever route applies. Has three exits
# (offline skeleton, reuse existing, fresh pull), which is why the reporting
# lives in the wrapper below rather than in here -- a per-exit call was added to
# only one of the three and silently skipped the two that actually create the
# file.
resolve_web_env() {
  if [[ "$OFFLINE" -eq 1 ]]; then
    create_env_skeleton
    return
  fi

  if [[ -f "$WEB_ENV_FILE" && "$FORCE_ENV_PULL" -eq 0 ]]; then
    ok "using existing apps/web/.env.local"
    ensure_better_auth_secret
    return
  fi

  link_vercel_if_requested

  info "Pulling Vercel ${ENVIRONMENT} environment to apps/web/.env.local"
  local tmp_dir
  local tmp_file
  tmp_dir="$(mktemp -d)"
  tmp_file="$tmp_dir/.env.local"
  if (cd "$ROOT_DIR" && vercel env pull "$tmp_file" --environment="$ENVIRONMENT"); then
    mv "$tmp_file" "$WEB_ENV_FILE"
    rmdir "$tmp_dir"
    chmod 600 "$WEB_ENV_FILE"
    ensure_better_auth_secret
    ok "Vercel ${ENVIRONMENT} env written to apps/web/.env.local"
  else
    rm -rf "$tmp_dir"
    die "failed to pull Vercel ${ENVIRONMENT} env. Check Vercel auth/linking, or rerun with --offline"
  fi
}

# Single entry point. Reports the resolved database target on EVERY route that
# finalizes .env.local -- offline skeleton, reuse, and fresh pull alike. A failed
# pull calls die() and never reaches here, which is correct: there is no env to
# report on.
pull_vercel_env() {
  resolve_web_env
  report_database_target
}

missing_keys_csv() {
  local file="$1"
  shift
  local missing=()
  local key

  for key in "$@"; do
    if ! env_has_value "$file" "$key"; then
      missing+=("$key")
    fi
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    join_keys "${missing[@]}"
    return 1
  fi

  return 0
}

join_keys() {
  local first=1
  local key
  for key in "$@"; do
    if [[ "$first" -eq 0 ]]; then
      printf ', '
    fi
    printf '%s' "$key"
    first=0
  done
}

validate_env() {
  [[ -f "$WEB_ENV_FILE" ]] || die "apps/web/.env.local is missing"

  info "Validating local env"

  local runnable_missing=""
  if ! runnable_missing="$(missing_keys_csv "$WEB_ENV_FILE" POSTGRES_URL BETTER_AUTH_SECRET)"; then
    if [[ "$OFFLINE" -eq 1 ]]; then
      warn "missing runnable env keys: $runnable_missing"
    else
      die "missing runnable env keys in apps/web/.env.local: $runnable_missing"
    fi
  fi

  local sign_in_missing=""
  if ! sign_in_missing="$(missing_keys_csv \
    "$WEB_ENV_FILE" \
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID \
    VERCEL_APP_CLIENT_SECRET \
    NEXT_PUBLIC_GITHUB_CLIENT_ID \
    GITHUB_CLIENT_SECRET)"; then
    warn "sign-in will be limited until these keys are set: $sign_in_missing"
  fi

  local repo_missing=""
  if ! repo_missing="$(missing_keys_csv \
    "$WEB_ENV_FILE" \
    GITHUB_APP_ID \
    GITHUB_APP_PRIVATE_KEY \
    NEXT_PUBLIC_GITHUB_APP_SLUG \
    GITHUB_WEBHOOK_SECRET)"; then
    warn "repo-backed agent work will be limited until these keys are set: $repo_missing"
  fi

  if ! env_has_value "$WEB_ENV_FILE" "AI_GATEWAY_API_KEY"; then
    info "No AI_GATEWAY_API_KEY found; public deployments use Vercel AI Gateway, while local default-gateway model calls need AI Gateway auth or a user/project provider override"
  fi

  if ! env_has_value "$WEB_ENV_FILE" "REDIS_URL" && ! env_has_value "$WEB_ENV_FILE" "KV_URL"; then
    warn "REDIS_URL/KV_URL are missing; rate-limited session and sandbox creation paths may fail locally"
  fi

  if env_has_value "$WEB_ENV_FILE" "BETTER_AUTH_URL"; then
    warn "BETTER_AUTH_URL is set; local OAuth may redirect to that canonical URL instead of ${LOCAL_URL}"
  fi

  ok "env validation complete"
}

run_typecheck() {
  if [[ "$SKIP_CHECKS" -eq 1 ]]; then
    warn "skipping typecheck"
    return
  fi

  info "Running typecheck"
  (cd "$ROOT_DIR" && bun --bun run typecheck)
  ok "typecheck passed"
}

smoke_existing_server() {
  curl -fsS "$LOCAL_URL/api/auth/info" >/dev/null
}

verify_dev_server() {
  if [[ "$VERIFY" -ne 1 ]]; then
    return 0
  fi

  info "Running local dev server smoke"
  if smoke_existing_server; then
    ok "existing dev server responded at $LOCAL_URL"
    return
  fi

  local log_file
  log_file="$(mktemp -t open-agents-init.XXXXXX.log)"
  local server_pid

  info "Starting temporary dev server"
  (cd "$ROOT_DIR" && bun run web >"$log_file" 2>&1) &
  server_pid=$!

  local ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$server_pid" >/dev/null 2>&1; then
      cat "$log_file" >&2
      rm -f "$log_file"
      die "temporary dev server exited before becoming ready"
    fi

    if smoke_existing_server; then
      ready=1
      break
    fi

    sleep 1
  done

  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true

  if [[ "$ready" -ne 1 ]]; then
    cat "$log_file" >&2
    rm -f "$log_file"
    die "dev server did not respond at $LOCAL_URL within 60 seconds"
  fi

  rm -f "$log_file"
  ok "temporary dev server responded at $LOCAL_URL"
}

main() {
  parse_args "$@"
  require_repo_root
  require_tools

  info "Initializing Open Agents local development"
  install_dependencies
  install_git_hooks
  pull_vercel_env
  validate_env

  if [[ "$VERIFY" -eq 1 || "$CI_MODE" -eq 1 ]]; then
    run_typecheck
  fi
  verify_dev_server

  ok "local setup complete"
  printf '\nNext step: bun run web\n'
}

main "$@"
