#!/bin/bash
set -e

echo "==================================================="
echo "   CCTV Stream Control - Setup & Deployment Script"
echo "==================================================="

# 1. Detect OS and Architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
echo "Detected OS: $OS"
echo "Detected Architecture: $ARCH"

# Map to go2rtc binary names
GO2RTC_BINARY=""
if [ "$OS" = "darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        GO2RTC_BINARY="go2rtc_mac_arm64"
    else
        GO2RTC_BINARY="go2rtc_mac_amd64"
    fi
elif [ "$OS" = "linux" ]; then
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        GO2RTC_BINARY="go2rtc_linux_arm64"
    elif [[ "$ARCH" == armv* ]]; then
        GO2RTC_BINARY="go2rtc_linux_arm"
    elif [ "$ARCH" = "x86_64" ]; then
        GO2RTC_BINARY="go2rtc_linux_amd64"
    else
        echo "Unsupported Linux architecture: $ARCH"
        exit 1
    fi
else
    echo "Unsupported OS: $OS"
    exit 1
fi

# 2. Download go2rtc
echo "Downloading $GO2RTC_BINARY..."
mkdir -p backend/bin
if [[ "$GO2RTC_BINARY" == *"mac"* || "$GO2RTC_BINARY" == *"win"* ]]; then
    curl -L -o backend/bin/go2rtc.zip "https://github.com/AlexxIT/go2rtc/releases/latest/download/${GO2RTC_BINARY}.zip"
    unzip -o backend/bin/go2rtc.zip -d backend/bin/
    rm backend/bin/go2rtc.zip
else
    curl -L -o backend/bin/go2rtc "https://github.com/AlexxIT/go2rtc/releases/latest/download/$GO2RTC_BINARY"
fi
chmod +x backend/bin/go2rtc
echo "go2rtc downloaded successfully."

# 3. Install dependencies and build frontend
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
