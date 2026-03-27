# Deployment Guide

## Quick Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your OpenAI API key
nano .env
```

Required environment variables:
- `OPENAI_API_KEY` - Your OpenAI API key (get from https://platform.openai.com/api-keys)
- `VOICE` - Voice to use (default: shimmer)
- `TEMPERATURE` - AI temperature (default: 0.8)
- `SYSTEM_MESSAGE` - System prompt for the AI

### 3. Test the Application

```bash
# Run manually to test
npm start

# Visit http://localhost:3000 to test the web interface
```

## Systemd Service Setup

### Install the Service

```bash
# Copy service file to systemd directory
sudo cp companion.service /etc/systemd/system/

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable companion

# Start the service
sudo systemctl start companion

# Check service status
sudo systemctl status companion
```

### Service Management

```bash
# Start service
sudo systemctl start companion

# Stop service
sudo systemctl stop companion

# Restart service
sudo systemctl restart companion

# View logs
sudo journalctl -u companion -f

# View last 50 log entries
sudo journalctl -u companion -n 50
```

### Update Deployment

When you update the code:

```bash
# Pull latest changes
git pull origin <branch-name>

# Install any new dependencies
npm install

# Restart the service
sudo systemctl restart companion
```

## Troubleshooting

### Service won't start

1. **Check dependencies are installed:**
   ```bash
   ls node_modules
   ```
   If empty, run: `npm install`

2. **Check .env file exists:**
   ```bash
   cat .env
   ```
   If missing, copy from `.env.example` and add your API key

3. **Check API key is valid:**
   - Ensure OPENAI_API_KEY is set in .env
   - Verify key at https://platform.openai.com/api-keys

4. **Check service logs:**
   ```bash
   sudo journalctl -u companion -n 100 --no-pager
   ```

5. **Test manual start:**
   ```bash
   cd /home/user/companion
   npm start
   ```

### Port already in use

If port 3000 is already in use, add to `.env`:
```bash
PORT=3001
```

Then restart the service.

## Service File Location

The systemd service file should be installed at:
```
/etc/systemd/system/companion.service
```

Working directory:
```
/home/user/companion
```

## Logs

Service logs are available via journalctl:
```bash
# Follow logs in real-time
sudo journalctl -u companion -f

# Show last 50 entries
sudo journalctl -u companion -n 50

# Show logs since last boot
sudo journalctl -u companion -b
```

## Security Notes

- The service runs as root user (configured in companion.service)
- Ensure .env file has proper permissions: `chmod 600 .env`
- Never commit .env file to git (it's in .gitignore)
- Rotate API keys regularly
