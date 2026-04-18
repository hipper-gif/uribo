#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_KEY="$HOME/.ssh/xserver_twinklemark"
SSH_USER="twinklemark"
SSH_HOST="sv16114.xserver.jp"
SSH_PORT="10022"
SSH_OPTS="-P $SSH_PORT -i $SSH_KEY"
REMOTE_DIR="~/twinklemark.xsrv.jp/public_html/uribo/"

echo "=== Uribo Deploy ==="

echo "[1/3] Building..."
cd "$SCRIPT_DIR/frontend"
npm run build

echo "[2/3] Deploying to $SSH_HOST..."
scp $SSH_OPTS -r dist/.htaccess dist/* "$SSH_USER@$SSH_HOST:$REMOTE_DIR"

echo "[3/3] Verifying..."
ssh -p "$SSH_PORT" -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "ls -la ${REMOTE_DIR}index.html"

echo "=== Done! ==="
echo "https://twinklemark.xsrv.jp/uribo/"
