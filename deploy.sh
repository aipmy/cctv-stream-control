#!/usr/bin/env bash
set -euo pipefail

APP_NAME="cctv-monitoring-lite"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if [[ ! -f backend/.env ]]; then
  echo "backend/.env belum ada. Salin backend/.env.example lalu isi AUTH_SECRET."
  exit 1
fi


echo "==> Installing frontend deps"
npm install --no-audit --no-fund --progress=false --loglevel=info

echo "==> Installing backend deps"
cd backend
npm install --no-audit --no-fund --progress=false --loglevel=info
cd "$ROOT_DIR"

echo "==> Building frontend"
npm run build

echo "==> Starting PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 delete "$APP_NAME"
fi
pm2 start ecosystem.config.cjs
pm2 save

echo "==> Done. Open http://SERVER_IP:4200"
