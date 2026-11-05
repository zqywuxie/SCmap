#!/usr/bin/env bash
# First deployment and subsequent updates: bash deploy.sh
set -Eeuo pipefail
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15}"
REPO_URL="${REPO_URL:-git@github.com:zqywuxie/SCmap.git}"
BRANCH="${BRANCH:-main}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/.git" ]]; then DEFAULT_DIR="$SCRIPT_DIR"; else DEFAULT_DIR="$HOME/scmap"; fi
SCMAP_DIR="${SCMAP_DIR:-$DEFAULT_DIR}"
APP_NAME="${APP_NAME:-scmap}"
PORT="${PORT:-10323}"
BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949}"
export REPO_URL BRANCH SCMAP_DIR APP_NAME PORT BIND_ADDRESS NGINX_IMAGE
fail() { echo "ERROR: $*" >&2; exit 1; }
for cmd in git docker curl python3 flock; do command -v "$cmd" >/dev/null || fail "Install $cmd first (see DEPLOY.md)."; done
SCMAP_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$SCMAP_DIR")"
export SCMAP_DIR
[[ "$APP_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail 'Invalid APP_NAME'
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 0 && PORT < 65536 )) || fail 'Invalid PORT'
[[ "$BIND_ADDRESS" =~ ^[0-9.]+$ ]] || fail 'BIND_ADDRESS must be an IPv4 address'
docker info >/dev/null 2>&1 || fail 'Docker is unavailable or this user lacks access.'

if [[ "${1:-}" == '--check' ]]; then
    cd "$SCRIPT_DIR"
    python3 validate_data.py
    echo 'CHECK_OK (no clone, build or container changes)'
    exit 0
fi

if [[ "${1:-}" != '--activate' ]]; then
    if [[ ! -e "$SCMAP_DIR" ]]; then
        git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$SCMAP_DIR"
    fi
    cd "$SCMAP_DIR"
    [[ -d .git ]] || fail "$SCMAP_DIR is not a Git checkout"
    [[ "$(git remote get-url origin)" == "$REPO_URL" ]] || fail 'origin differs from REPO_URL'
    [[ -z "$(git status --porcelain)" ]] || fail 'Checkout has local edits; commit or move them before deployment.'
    [[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "Checkout must be on $BRANCH"
    exec 9>.git/scmap-deploy.lock
    flock -n 9 || fail 'Another deployment is running'
    git fetch --prune origin "$BRANCH"
    git merge --ff-only "origin/$BRANCH"
    [[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] || fail 'Local commits are ahead of origin; push or move them before deployment.'
    # Execute the newly fetched script, keeping the same process and deployment lock.
    exec bash "$SCMAP_DIR/deploy.sh" --activate
fi

cd "$SCMAP_DIR"
python3 validate_data.py
REVISION="$(git rev-parse HEAD)"
IMAGE="scmap:${REVISION}"
CANDIDATE="${APP_NAME}-candidate-$$"
BACKUP="${APP_NAME}-previous"
switching=0
owned() { [[ "$(docker inspect -f '{{index .Config.Labels "org.scmap.app"}}' "$1" 2>/dev/null)" == "$APP_NAME" ]]; }
exists() { docker container inspect "$1" >/dev/null 2>&1; }
wait_http() {
    local attempt
    for attempt in {1..15}; do
        if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "$1"; then return 0; fi
        sleep 1
    done
    return 1
}
for name in "$APP_NAME" "$BACKUP"; do
    if exists "$name" && ! owned "$name"; then fail "Container $name belongs to another application"; fi
done
cleanup() {
    local result=$?
    trap - EXIT
    if exists "$CANDIDATE" && owned "$CANDIDATE"; then docker rm -f "$CANDIDATE" >/dev/null || true; fi
    if (( result != 0 && switching == 1 )); then
        echo 'Deployment failed; restoring previous container.' >&2
        if exists "$APP_NAME" && owned "$APP_NAME"; then docker rm -f "$APP_NAME" >/dev/null || true; fi
        if exists "$BACKUP" && owned "$BACKUP"; then docker rename "$BACKUP" "$APP_NAME"; docker start "$APP_NAME" >/dev/null; fi
    fi
    exit "$result"
}
trap cleanup EXIT
docker build --build-arg "NGINX_IMAGE=$NGINX_IMAGE" --label "org.scmap.revision=$REVISION" -t "$IMAGE" .
docker run --rm --entrypoint nginx "$IMAGE" -t
docker run -d --name "$CANDIDATE" --label "org.scmap.app=$APP_NAME" -p 127.0.0.1::80 "$IMAGE" >/dev/null
TEST_PORT="$(docker port "$CANDIDATE" 80/tcp)"; TEST_PORT="${TEST_PORT##*:}"
wait_http "http://127.0.0.1:$TEST_PORT/healthz"
wait_http "http://127.0.0.1:$TEST_PORT/data/manifest.json" >/dev/null
docker rm -f "$CANDIDATE" >/dev/null
if exists "$BACKUP"; then docker rm "$BACKUP" >/dev/null; fi
if exists "$APP_NAME"; then
    docker rename "$APP_NAME" "$BACKUP"
fi
switching=1
if exists "$BACKUP"; then docker stop "$BACKUP" >/dev/null; fi
docker run -d --name "$APP_NAME" --restart unless-stopped --label "org.scmap.app=$APP_NAME" \
    --label "org.scmap.revision=$REVISION" -p "$BIND_ADDRESS:$PORT:80" "$IMAGE" >/dev/null
HEALTH_HOST="$BIND_ADDRESS"; [[ "$HEALTH_HOST" != '0.0.0.0' ]] || HEALTH_HOST=127.0.0.1
wait_http "http://$HEALTH_HOST:$PORT/healthz"
switching=0
echo "DEPLOY_OK $REVISION http://$BIND_ADDRESS:$PORT (previous container: $BACKUP)"
