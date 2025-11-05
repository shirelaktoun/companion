#!/bin/bash
#
# Uninstallation script for AI Companion PBX Agent
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/ai-companion"
LOG_DIR="/var/log/ai-companion"
SERVICE_FILE="/etc/systemd/system/ai-companion.service"

echo -e "${YELLOW}AI Companion PBX Agent Uninstallation${NC}"
echo "=========================================="
echo

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: This script must be run as root${NC}"
  exit 1
fi

# Confirm uninstallation
read -p "Are you sure you want to uninstall AI Companion? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  exit 0
fi

echo "Stopping and disabling service..."
if systemctl is-active --quiet ai-companion; then
  systemctl stop ai-companion
fi
if systemctl is-enabled --quiet ai-companion; then
  systemctl disable ai-companion
fi

echo "Removing systemd service..."
if [ -f "$SERVICE_FILE" ]; then
  rm "$SERVICE_FILE"
  systemctl daemon-reload
fi

echo "Removing application files..."
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
fi

echo "Removing log directory..."
read -p "Remove logs at $LOG_DIR? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -rf "$LOG_DIR"
fi

echo "Removing system user..."
if id -u companion &>/dev/null; then
  userdel companion
fi

echo -e "${GREEN}Uninstallation complete!${NC}"
