#!/usr/bin/env bash
set -euo pipefail

CAWANG_HOST="172.16.20.11"
CAWANG_USER="mac-radar"
CAWANG_PASS="K@t4kunci"

echo "========================================="
echo "Deploying to CAWANG (Mac Mini) - Rsync/SCP"
echo "========================================="
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
  sed -i '' 's/STREAM_READ_TIMEOUT_US=5000000/STREAM_READ_TIMEOUT_US=20000000/g' backend/.env && \
  (grep -q \"VIDEO_ENCODER=\" backend/.env && sed -i '' 's/VIDEO_ENCODER=.*/VIDEO_ENCODER=h264_videotoolbox/g' backend/.env || echo \"VIDEO_ENCODER=h264_videotoolbox\" >> backend/.env) && \
  (grep -q \"RTSP_TIMEOUT_OPTION=\" backend/.env && sed -i '' 's/RTSP_TIMEOUT_OPTION=.*/RTSP_TIMEOUT_OPTION=timeout/g' backend/.env || echo \"RTSP_TIMEOUT_OPTION=timeout\" >> backend/.env) && \
  ./deploy.sh
"
