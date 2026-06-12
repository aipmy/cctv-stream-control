#!/usr/bin/env bash
set -euo pipefail

APP_NAME="cctv-monitoring-lite"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if [[ ! -f backend/.env ]]; then
  echo "backend/.env belum ada. Salin backend/.env.example lalu isi AUTH_SECRET."
  exit 1
fi

if [[ -d backend/data ]]; then
  BACKUP_DIR="backend/backups/data_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  cp -a backend/data/. "$BACKUP_DIR/"
  echo "==> Data backup: $BACKUP_DIR"
fi

echo "==> Installing frontend deps"
npm install

echo "==> Installing backend deps"
cd backend
npm install
cd "$ROOT_DIR"

echo "==> Building frontend"
npm run build

echo "==> Starting PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "==> Done. Open http://SERVER_IP:4200"
