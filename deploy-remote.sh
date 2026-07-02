#!/usr/bin/env bash
set -euo pipefail

# Configurations
KOST_HOST="172.20.20.197"
KOST_USER="aipmy"
KOST_PASS="adminaip0020"

CAWANG_HOST="172.16.20.11"
CAWANG_USER="mac-radar"
CAWANG_PASS="K@t4kunci"

echo "========================================="
echo "Deploying to KOST (Raspberry Pi) - Git pull"
echo "========================================="
sshpass -p "$KOST_PASS" ssh -o StrictHostKeyChecking=no "$KOST_USER@$KOST_HOST" "
  cd ~/Projects/cctv-stream-control && \
  git reset --hard HEAD && \
  git clean -fd && \
  git pull && \
  sed -i 's/MJPEG_WIDTH=320/MJPEG_WIDTH=854/g' backend/.env && \
  sed -i 's/MJPEG_QUALITY=7/MJPEG_QUALITY=4/g' backend/.env && \
  sed -i 's/MJPEG_FPS=4/MJPEG_FPS=6/g' backend/.env && \
  ./deploy.sh
"

echo "========================================="
echo "Deploying to CAWANG (Mac Mini) - Rsync/SCP"
echo "========================================="
# Sync files, preserving remote Cawang's own .env config
rsync -avz \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'backend/data' \
  --exclude 'backend/storage' \
  --exclude 'backend/node_modules' \
  --exclude 'backend/.env' \
  --exclude 'deploy-remote.sh' \
  -e "sshpass -p '$CAWANG_PASS' ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  ./ "$CAWANG_USER@$CAWANG_HOST:~/Projects/cctv-stream-control/"

sshpass -p "$CAWANG_PASS" ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes "$CAWANG_USER@$CAWANG_HOST" "
  export NVM_DIR=\"\$HOME/.nvm\"
  [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"
  cd ~/Projects/cctv-stream-control && \
  sed -i '' 's/MJPEG_WIDTH=320/MJPEG_WIDTH=854/g' backend/.env && \
  sed -i '' 's/MJPEG_QUALITY=7/MJPEG_QUALITY=4/g' backend/.env && \
  sed -i '' 's/MJPEG_FPS=4/MJPEG_FPS=6/g' backend/.env && \
  ./deploy.sh
"

echo "========================================="
echo "All deployments completed successfully!"
echo "========================================="
