#!/bin/bash
set -e

echo "==================================================="
echo "   CCTV Stream Control - Setup & Deployment Script"
echo "==================================================="

# 1. Install dependencies and build frontend
echo "Installing frontend dependencies..."
npm install
echo "Building frontend..."
npm run build

echo "Installing backend dependencies..."
cd backend
npm install
cd ..

# 4. Generate PM2 Ecosystem file
cat << 'EOF' > ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "cctv-go2rtc",
      script: "./backend/bin/go2rtc",
      args: "-c ./backend/go2rtc.yaml",
      cwd: "./",
      watch: false,
      restart_delay: 5000,
    },
    {
      name: "cctv-backend",
      script: "./backend/src/server.js",
      cwd: "./",
      watch: false,
      env: {
        NODE_ENV: "production",
      }
    }
  ]
}
EOF

echo "==================================================="
echo "Setup Complete!"
echo "To run this application in production (e.g. on your Raspberry Pi), run:"
echo "  pm2 start ecosystem.config.cjs"
echo "  pm2 save"
echo "==================================================="
