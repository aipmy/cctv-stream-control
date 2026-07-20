#!/usr/bin/env bash
set -e

echo "==================================================="
echo "   Auto-Detecting OS & Architecture for go2rtc"
echo "==================================================="

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
echo "Detected OS: $OS"
echo "Detected Architecture: $ARCH"

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

mkdir -p bin
if [[ "$GO2RTC_BINARY" == *"mac"* || "$GO2RTC_BINARY" == *"win"* ]]; then
    curl -L -o bin/go2rtc.zip "https://github.com/AlexxIT/go2rtc/releases/latest/download/${GO2RTC_BINARY}.zip"
    unzip -o bin/go2rtc.zip -d bin/
    rm bin/go2rtc.zip
else
    curl -L -o bin/go2rtc "https://github.com/AlexxIT/go2rtc/releases/latest/download/$GO2RTC_BINARY"
fi

chmod +x bin/go2rtc
echo "go2rtc downloaded successfully for $OS ($ARCH)."
