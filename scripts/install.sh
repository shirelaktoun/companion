#!/bin/bash
#
# Installation script for AI Companion PBX Agent on Debian 13
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Installation directory
INSTALL_DIR="/opt/ai-companion"
LOG_DIR="/var/log/ai-companion"
SERVICE_FILE="/etc/systemd/system/ai-companion.service"

echo -e "${GREEN}AI Companion PBX Agent Installation${NC}"
echo "========================================"
echo

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: This script must be run as root${NC}"
  exit 1
fi

# Check Debian version
if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [[ "$ID" != "debian" ]]; then
    echo -e "${YELLOW}Warning: This script is designed for Debian. Detected OS: $ID${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi
fi

echo "Step 1: Installing system dependencies..."
apt-get update
apt-get install -y curl gnupg build-essential python3

# Install Node.js 18+
if ! command -v node &> /dev/null || [ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]; then
  echo "Installing Node.js 18..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js $(node -v) is already installed"
fi

echo
echo "Step 2: Creating system user and directories..."

# Create system user
if ! id -u companion &>/dev/null; then
  useradd -r -s /bin/false -d "$INSTALL_DIR" -c "AI Companion Agent" companion
  echo "Created user 'companion'"
else
  echo "User 'companion' already exists"
fi

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$INSTALL_DIR/audio-cache"

echo
echo "Step 3: Copying application files..."

# Copy application files
cp -r package.json tsconfig.json src "$INSTALL_DIR/"

# Copy environment template if .env doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp .env.example "$INSTALL_DIR/.env"
  echo -e "${YELLOW}Created .env file. Please edit $INSTALL_DIR/.env with your configuration${NC}"
else
  echo ".env file already exists, not overwriting"
fi

# Set ownership
chown -R companion:companion "$INSTALL_DIR"
chown -R companion:companion "$LOG_DIR"

echo
echo "Step 4: Installing Node.js dependencies..."
cd "$INSTALL_DIR"
sudo -u companion npm install --production=false

echo
echo "Step 5: Building application..."
sudo -u companion npm run build

echo
echo "Step 6: Installing systemd service..."
cp deployment/ai-companion.service "$SERVICE_FILE"
systemctl daemon-reload

echo
echo "Step 7: Configuration..."
echo -e "${YELLOW}Before starting the service, please:${NC}"
echo "  1. Edit $INSTALL_DIR/.env with your configuration"
echo "  2. Add your Asterisk/FreePBX credentials"
echo "  3. Add your Anthropic API key"
echo "  4. Add your Deepgram API key (for speech-to-text)"
echo "  5. Add your Google Cloud credentials (for text-to-speech)"
echo

echo -e "${GREEN}Installation complete!${NC}"
echo
echo "To start the service:"
echo "  systemctl start ai-companion"
echo
echo "To enable auto-start on boot:"
echo "  systemctl enable ai-companion"
echo
echo "To view logs:"
echo "  journalctl -u ai-companion -f"
echo "  or check: $LOG_DIR/companion.log"
echo
