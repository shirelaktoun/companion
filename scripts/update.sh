#!/bin/bash
#
# Update script for AI Companion PBX Agent
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

INSTALL_DIR="/opt/ai-companion"

echo -e "${GREEN}AI Companion PBX Agent Update${NC}"
echo "================================"
echo

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: This script must be run as root${NC}"
  exit 1
fi

# Check if installed
if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${RED}Error: AI Companion does not appear to be installed${NC}"
  exit 1
fi

echo "Stopping service..."
systemctl stop ai-companion

echo "Backing up configuration..."
cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup"

echo "Updating application files..."
cp -r "$SOURCE_DIR/src" "$INSTALL_DIR/"
cp "$SOURCE_DIR/package.json" "$SOURCE_DIR/tsconfig.json" "$INSTALL_DIR/"
cp -r "$SOURCE_DIR/deployment" "$INSTALL_DIR/" 2>/dev/null || true

echo "Installing/updating dependencies..."
cd "$INSTALL_DIR"
sudo -u companion npm install --production=false

echo "Rebuilding application..."
sudo -u companion npm run build

echo "Restoring configuration..."
mv "$INSTALL_DIR/.env.backup" "$INSTALL_DIR/.env"

echo "Starting service..."
systemctl start ai-companion

echo
echo -e "${GREEN}Update complete!${NC}"
echo
echo "Check service status:"
echo "  systemctl status ai-companion"
echo
echo "View logs:"
echo "  journalctl -u ai-companion -f"
echo
