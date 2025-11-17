# AI Companion - Telephony Integration
## Dial Extension 7000 to Talk to Your AI Assistant

This guide explains how to integrate the AI Companion with Asterisk/FreePBX so you can dial extension 7000 to talk to the AI assistant via telephone.

## Architecture

```
Phone → Asterisk (Extension 7000) → Telephony Server (AGI Port 4000) → AI Agent → OpenAI Realtime API
```

## Prerequisites

1. **Asterisk** or **FreePBX** installed and running
2. **Node.js** application running (web server on port 3000)
3. **AGI Port** 4000 accessible from Asterisk

## Installation Steps

### Step 1: Install Dependencies

```bash
cd /home/user/companion

# Install if using npm run all (optional)
npm install --save-dev concurrently
```

### Step 2: Configure Asterisk Extension

#### Option A: FreePBX GUI

1. Log into FreePBX admin panel
2. Go to **Applications** → **Extensions**
3. Click **Add Extension** → **Custom Extension**
4. Set **Extension Number**: `7000`
5. Set **Display Name**: `AI Companion`
6. In **Custom Dial String**: `Local/ai-companion@custom-ai`
7. Save and Apply Config

Then create custom context in `/etc/asterisk/extensions_custom.conf`:

```asterisk
[custom-ai]
exten => ai-companion,1,NoOp(AI Companion Call)
 same => n,Answer()
 same => n,Wait(0.5)
 same => n,AGI(agi://127.0.0.1:4000)
 same => n,Hangup()
```

#### Option B: Manual Asterisk Configuration

Copy the extension configuration:

```bash
sudo cp /home/user/companion/asterisk-config/extensions_companion.conf /etc/asterisk/
```

Edit `/etc/asterisk/extensions.conf` and add at the bottom:

```asterisk
#include extensions_companion.conf
```

Reload the dialplan:

```bash
asterisk -rx "dialplan reload"
```

Verify the extension:

```bash
asterisk -rx "dialplan show 7000"
```

You should see:
```
[ Context 'from-internal-custom' created by 'pbx_config' ]
  '7000' =>           1. NoOp(Incoming call to AI Companion)
                      2. Answer()
                      3. Wait(1)
                      4. Playback(silence/1)
                      5. AGI(agi://localhost:4000/ai-companion)
                      6. Hangup()
```

### Step 3: Configure Environment

Edit `/opt/companion/.env` and add:

```bash
# Telephony Configuration
AGI_PORT=4000
```

### Step 4: Start the Telephony Server

#### Option 1: Run Both Servers

```bash
cd /opt/companion

# Start both web and telephony servers
npm run all
```

#### Option 2: Run Separately

Terminal 1 (Web Server):
```bash
cd /opt/companion
npm start
```

Terminal 2 (Telephony Server):
```bash
cd /opt/companion
npm run telephony
```

You should see:
```
📞 AI Companion Telephony Server Starting...
   AGI Port: 4000
   Voice: shimmer
   Temperature: 0.8

✅ Telephony server listening on port 4000
   Extension: 7000
   Ready to receive calls!
```

### Step 5: Create Systemd Services (Optional but Recommended)

Create service files to run automatically:

**/etc/systemd/system/companion-web.service**:
```ini
[Unit]
Description=AI Companion Web Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/companion
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**/etc/systemd/system/companion-telephony.service**:
```ini
[Unit]
Description=AI Companion Telephony Server
After=network.target asterisk.service
Requires=asterisk.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/companion
ExecStart=/usr/bin/npm run telephony
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable companion-web companion-telephony
sudo systemctl start companion-web companion-telephony
sudo systemctl status companion-web companion-telephony
```

## Testing

### Test 1: Check Extension in Dialplan

```bash
asterisk -rx "dialplan show 7000"
```

### Test 2: Check AGI Server

```bash
# Check if telephony server is running
ps aux | grep telephony-server

# Check if port 4000 is listening
netstat -tlnp | grep 4000
# or
lsof -i :4000
```

### Test 3: Make a Test Call

1. Pick up any phone on your PBX
2. Dial **7000**
3. You should hear: "Hello! This is your AI assistant. How can I help you today?"
4. Start talking!

### Test 4: Watch the Logs

Terminal 1:
```bash
tail -f /var/log/asterisk/full | grep 7000
```

Terminal 2:
```bash
# If running manually
cd /opt/companion && npm run telephony

# If using systemd
journalctl -u companion-telephony -f
```

You should see:
```
📞 Call from 1001
   👤 Hello, what's the weather like?
   🤖 I'm happy to help, but I don't have real-time weather data...
📞 Call ended
```

## Troubleshooting

### Extension 7000 Says "Number Not in Service"

Check dialplan:
```bash
asterisk -rx "dialplan reload"
asterisk -rx "dialplan show 7000"
```

### Call Connects But No Audio

1. **Check AGI server is running**:
   ```bash
   netstat -tlnp | grep 4000
   ```

2. **Check Asterisk can reach AGI server**:
   ```bash
   telnet localhost 4000
   ```

3. **Check Asterisk logs**:
   ```bash
   tail -f /var/log/asterisk/full
   ```

Look for AGI connection errors.

### "Failed to Connect to AGI Server"

1. **Firewall**: Make sure port 4000 is accessible:
   ```bash
   iptables -A INPUT -p tcp --dport 4000 -s 127.0.0.1 -j ACCEPT
   ```

2. **Check server is running**:
   ```bash
   ps aux | grep telephony
   ```

3. **Restart telephony server**:
   ```bash
   systemctl restart companion-telephony
   ```

### Audio Quality Issues

The telephony server converts between μ-law 8kHz (telephony) and PCM16 24kHz (OpenAI). If you hear:

- **Robotic voice**: Sample rate conversion issue
- **Choppy audio**: Network latency or CPU load
- **Echo**: Disable echo cancellation in phone

Adjust in `/opt/companion/.env`:
```bash
# Try different voice
VOICE=alloy
# or
VOICE=echo

# Adjust temperature for more/less creative responses
TEMPERATURE=0.6
```

### High Latency

1. **Check network**:
   ```bash
   ping api.openai.com
   ```

2. **Monitor server load**:
   ```bash
   top
   ```

3. **Check OpenAI API status**: https://status.openai.com/

## Advanced Configuration

### Custom Greeting

Edit `/opt/companion/.env`:
```bash
TELEPHONY_GREETING="Hi! You've reached the AI assistant hotline. How can I help?"
```

### Different AI Personality for Phone Calls

Update `SYSTEM_MESSAGE` in `.env`:
```bash
SYSTEM_MESSAGE="You are a professional phone receptionist AI. Be polite, concise, and helpful. Keep responses short since this is a phone call. Speak clearly and avoid technical jargon."
```

### Call Recording

Add to Asterisk dialplan before AGI:
```asterisk
same => n,MixMonitor(/var/spool/asterisk/monitor/ai-companion-${UNIQUEID}.wav)
```

### Multiple Extensions

Create additional extensions for different AI personalities:

```asterisk
; Extension 7001 - Technical Support AI
exten => 7001,1,NoOp(Technical Support AI)
 same => n,Answer()
 same => n,Set(AI_PERSONALITY=technical)
 same => n,AGI(agi://localhost:4000/technical)
 same => n,Hangup()

; Extension 7002 - Sales AI
exten => 7002,1,NoOp(Sales AI)
 same => n,Answer()
 same => n,Set(AI_PERSONALITY=sales)
 same => n,AGI(agi://localhost:4000/sales)
 same => n,Hangup()
```

## Security Notes

1. **Internal Use Only**: The AGI port (4000) should only be accessible from localhost
2. **API Key**: Protect your OpenAI API key in `/opt/companion/.env`
3. **Call Costs**: OpenAI charges per minute of audio processed
4. **Rate Limiting**: Consider implementing call limits to prevent abuse

## Monitoring

### Check Active Calls

```bash
asterisk -rx "core show channels"
```

### Check AI Sessions

```bash
curl http://localhost:3000/sessions
```

### View Real-time Activity

```bash
# Asterisk console
asterisk -rvvv

# Watch telephony server logs
journalctl -u companion-telephony -f
```

## Cost Estimation

OpenAI Realtime API pricing (as of Nov 2024):
- **Audio input**: $0.06 per minute
- **Audio output**: $0.24 per minute
- **Total per call**: ~$0.30 per minute

Example: 100 calls/day × 3 minutes average = ~$90/day

Consider implementing:
- Call duration limits
- Usage monitoring
- Daily/monthly budget caps

## Next Steps

- [ ] Set up call recording for quality assurance
- [ ] Implement call transfer to human agents
- [ ] Add voicemail integration
- [ ] Create call analytics dashboard
- [ ] Set up SMS notifications for missed AI calls
- [ ] Integrate with CRM system

## Support

For issues:
1. Check logs: `journalctl -u companion-telephony -f`
2. Test AGI: `asterisk -rvvv` then dial 7000
3. Verify OpenAI API: Check your API key and credits

Happy calling! 📞🤖
