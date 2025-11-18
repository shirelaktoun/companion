# AI Companion - Multi-Server Deployment Guide

This guide covers deploying the AI Companion across two servers:
- **Application Server**: 87.106.74.102 (runs Node.js application)
- **Asterisk Server**: 87.106.72.7 (runs Asterisk PBX)

## Architecture

```
Phone → Asterisk (87.106.72.7:5060) → AudioSocket → App Server (87.106.74.102:4000) → OpenAI API
```

## Prerequisites

### On Application Server (87.106.74.102)

- Node.js 18+ installed
- Git installed
- Port 4000 open in firewall (for Asterisk to connect)
- Port 3000 open (optional, for web interface)
- Internet access to OpenAI API

### On Asterisk Server (87.106.72.7)

- Asterisk installed and running
- `app_audiosocket` module available
- Network access to 87.106.74.102:4000

---

## Part 1: Application Server Setup (87.106.74.102)

### Step 1: Clone Repository

```bash
# SSH to application server
ssh root@87.106.74.102

# Clone repository
cd /opt
git clone https://github.com/shirelaktoun/companion.git
cd /opt/companion
git checkout claude/improve-latency-01Br7shFvPcJEEAcNiGhkcBw
```

### Step 2: Install Dependencies

```bash
cd /opt/companion
npm install
```

### Step 3: Configure Environment

```bash
cat > /opt/companion/.env << 'EOF'
# OpenAI API Configuration
OPENAI_API_KEY=sk-your-actual-openai-key-here

# Server Configuration
USE_HTTPS=true
AUDIOSOCKET_PORT=4000
PORT=3000

# Asterisk Server (for reference)
ASTERISK_HOST=87.106.72.7

# AI Agent Configuration
VOICE=shimmer
TEMPERATURE=0.8

# System Message
SYSTEM_MESSAGE=You are a helpful AI assistant speaking on a phone call. Be concise and friendly. Keep responses brief since this is a phone conversation.
EOF

# IMPORTANT: Edit and add your real OpenAI API key
nano /opt/companion/.env
```

### Step 4: Generate SSL Certificates (for web interface)

```bash
cd /opt/companion
openssl req -x509 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=87.106.74.102"
```

### Step 5: Configure Firewall

**Critical**: Port 4000 must be accessible from the Asterisk server:

```bash
# Allow Asterisk server to connect to port 4000
iptables -A INPUT -p tcp -s 87.106.72.7 --dport 4000 -j ACCEPT

# Save iptables rules
iptables-save > /etc/iptables/rules.v4

# Or if using UFW:
ufw allow from 87.106.72.7 to any port 4000

# Optional: Allow web interface access
ufw allow 3000/tcp

# Verify port is open
netstat -tlnp | grep 4000
```

### Step 6: Create Systemd Services

**Web Server:**
```bash
cat > /etc/systemd/system/companion-web.service << 'EOF'
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
EOF
```

**Telephony Server:**
```bash
cat > /etc/systemd/system/companion-telephony.service << 'EOF'
[Unit]
Description=AI Companion Telephony Server
After=network.target

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
EOF
```

**Enable and start:**
```bash
systemctl daemon-reload
systemctl enable companion-web companion-telephony
systemctl start companion-web companion-telephony

# Check status
systemctl status companion-web
systemctl status companion-telephony
```

### Step 7: Verify Application Server

```bash
# Check telephony server is listening on 0.0.0.0:4000
netstat -tlnp | grep 4000

# Should show:
# tcp        0      0 0.0.0.0:4000            0.0.0.0:*               LISTEN      <PID>/node

# Check web server
curl -k https://localhost:3000/health

# Should return:
# {"status":"healthy","activeSessions":0,"uptime":...}

# Check logs
journalctl -u companion-telephony -f
```

You should see:
```
📞 AI Companion AudioSocket Server Starting...
   Port: 4000
✅ AudioSocket server listening on 0.0.0.0:4000
   Extension: 7000
   Accepting connections from Asterisk server
   Ready to receive calls!
```

---

## Part 2: Asterisk Server Setup (87.106.72.7)

### Step 1: Copy Dialplan Configuration

**On application server**, copy the remote dialplan file:
```bash
# Copy to a location accessible from Asterisk server
scp /opt/companion/asterisk-config/extensions_companion_remote.conf \
    root@87.106.72.7:/etc/asterisk/extensions_companion.conf
```

**Or create it manually on Asterisk server:**
```bash
# SSH to Asterisk server
ssh root@87.106.72.7

cat > /etc/asterisk/extensions_companion.conf << 'EOF'
[from-internal-custom]
; Extension 7000 - AI Companion (Remote Server)
exten => 7000,1,NoOp(Incoming call to AI Companion on 87.106.74.102)
 same => n,Answer()
 same => n,Wait(0.5)
 same => n,AudioSocket(40325ec4-1f0b-4d38-8c5d-23f9a71e7c75,87.106.74.102:4000)
 same => n,Hangup()
EOF
```

### Step 2: Update extensions.conf

```bash
# Add include to extensions.conf
echo "#include extensions_companion.conf" >> /etc/asterisk/extensions.conf
```

### Step 3: Load AudioSocket Module

```bash
# Load the module
asterisk -rx "module load app_audiosocket.so"

# Verify it's loaded
asterisk -rx "module show like audiosocket"

# Should show:
# app_audiosocket.so         AudioSocket Channel
```

### Step 4: Reload Dialplan

```bash
asterisk -rx "dialplan reload"

# Verify extension 7000
asterisk -rx "dialplan show 7000"
```

You should see:
```
'7000' =>           1. NoOp(Incoming call to AI Companion on 87.106.74.102)
                    2. Answer()
                    3. Wait(0.5)
                    4. AudioSocket(40325ec4-...,87.106.74.102:4000)
                    5. Hangup()
```

### Step 5: Test Network Connectivity

**From Asterisk server, test connection to application server:**

```bash
# Test port 4000 is reachable
telnet 87.106.74.102 4000

# Should connect successfully
# Press Ctrl+] then type 'quit' to exit

# Alternative test with nc
nc -zv 87.106.74.102 4000

# Should show: Connection to 87.106.74.102 4000 port [tcp/*] succeeded!
```

---

## Part 3: Testing

### Test 1: Network Connectivity

**From Asterisk server:**
```bash
ping -c 3 87.106.74.102
telnet 87.106.74.102 4000
```

**From Application server:**
```bash
ping -c 3 87.106.72.7
```

### Test 2: Check Services

**On Application Server (87.106.74.102):**
```bash
# Check telephony server
systemctl status companion-telephony
journalctl -u companion-telephony -n 20

# Check it's listening on all interfaces
netstat -tlnp | grep 4000
# Should show 0.0.0.0:4000, NOT 127.0.0.1:4000
```

**On Asterisk Server (87.106.72.7):**
```bash
# Check AudioSocket module
asterisk -rx "module show like audiosocket"

# Check dialplan
asterisk -rx "dialplan show 7000"

# Watch Asterisk console
asterisk -rvvv
```

### Test 3: Make a Test Call

1. From Asterisk server console:
   ```bash
   asterisk -rvvv
   ```

2. Pick up any phone on your PBX

3. Dial **7000**

4. You should hear: "Hello! This is your A I assistant. How can I help you today?"

5. Start talking!

**Watch the logs:**

On Application Server:
```bash
journalctl -u companion-telephony -f
```

You should see:
```
🔌 New AudioSocket connection
📞 Call UUID: 40325ec4-...
📞 Starting AI session for call ...
✅ AI session ready
   👤 What's the weather?
   🤖 I don't have access to real-time weather data...
📞 Call ended
```

On Asterisk Server:
```bash
# In asterisk console, you'll see:
AudioSocket/40325ec4-... is ringing
AudioSocket/40325ec4-... answered
```

---

## Troubleshooting

### Issue: "Connection Refused" from Asterisk

**Symptoms:**
```
Failed to create AudioSocket to 87.106.74.102:4000
Connection refused
```

**Solutions:**

1. **Check firewall on application server:**
   ```bash
   # On 87.106.74.102
   iptables -L -n | grep 4000

   # Should show rule allowing 87.106.72.7
   # If not, add it:
   iptables -A INPUT -p tcp -s 87.106.72.7 --dport 4000 -j ACCEPT
   ```

2. **Check server is listening on 0.0.0.0:**
   ```bash
   netstat -tlnp | grep 4000

   # Should show:
   # tcp  0  0  0.0.0.0:4000  0.0.0.0:*  LISTEN

   # If shows 127.0.0.1:4000, the server is only listening locally
   ```

3. **Check telephony server is running:**
   ```bash
   systemctl status companion-telephony
   journalctl -u companion-telephony -n 50
   ```

### Issue: No Audio on Call

**Check on Application Server:**
```bash
# Watch logs during call
journalctl -u companion-telephony -f

# Should see:
# 🔌 New AudioSocket connection
# 📞 Call UUID: ...
# 👤 (user speech)
# 🤖 (AI response)

# If you see connection but no audio:
# - Check OpenAI API key is valid
# - Check internet connectivity to api.openai.com
# - Check you have OpenAI credits
```

### Issue: Extension 7000 Not Found

```bash
# On Asterisk server
asterisk -rx "dialplan reload"
asterisk -rx "dialplan show 7000"

# If extension doesn't show:
# - Check extensions_companion.conf exists
# - Check it's included in extensions.conf
# - Check for syntax errors: asterisk -rx "core show hints"
```

### Issue: AudioSocket Module Not Found

```bash
# Check if module exists
ls -lh /usr/lib/asterisk/modules/app_audiosocket.so

# If missing, you may need to compile from source or install package
# For Ubuntu/Debian:
apt install asterisk-modules

# Load module
asterisk -rx "module load app_audiosocket.so"
```

---

## Security Considerations

1. **Firewall Rules**: Only allow Asterisk server (87.106.72.7) to access port 4000
   ```bash
   iptables -A INPUT -p tcp -s 87.106.72.7 --dport 4000 -j ACCEPT
   iptables -A INPUT -p tcp --dport 4000 -j DROP
   ```

2. **API Key Protection**: Keep `/opt/companion/.env` secure
   ```bash
   chmod 600 /opt/companion/.env
   ```

3. **SSL/TLS**: The connection between Asterisk and AudioSocket is NOT encrypted
   - Consider using VPN or SSH tunnel for added security
   - Or implement TLS in AudioSocket (requires custom development)

4. **Rate Limiting**: Consider implementing call limits to prevent abuse and cost overruns

---

## Monitoring

### Application Server (87.106.74.102)

```bash
# View telephony logs
journalctl -u companion-telephony -f

# View web logs
journalctl -u companion-web -f

# Check active sessions
curl -k https://localhost:3000/sessions

# Monitor system resources
htop
```

### Asterisk Server (87.106.72.7)

```bash
# Asterisk console
asterisk -rvvv

# Check active channels
asterisk -rx "core show channels"

# Check AudioSocket connections
asterisk -rx "core show channels" | grep AudioSocket
```

---

## Cost Management

OpenAI Realtime API pricing (approximate):
- **Audio input**: $0.06 per minute
- **Audio output**: $0.24 per minute
- **Total per call**: ~$0.30 per minute

**Example costs:**
- 10 calls/day × 5 minutes = ~$15/day = ~$450/month
- 50 calls/day × 3 minutes = ~$45/day = ~$1,350/month

**Recommendations:**
1. Set up billing alerts in OpenAI dashboard
2. Monitor usage: `curl -k https://87.106.74.102:3000/sessions`
3. Implement call duration limits in dialplan
4. Consider implementing usage quotas per user

---

## Quick Reference

### Application Server (87.106.74.102)

```bash
# Restart services
systemctl restart companion-web companion-telephony

# View logs
journalctl -u companion-telephony -f

# Check listening ports
netstat -tlnp | grep -E '3000|4000'

# Check sessions
curl -k https://localhost:3000/sessions
```

### Asterisk Server (87.106.72.7)

```bash
# Reload dialplan
asterisk -rx "dialplan reload"

# Check extension
asterisk -rx "dialplan show 7000"

# Test connectivity
telnet 87.106.74.102 4000

# View active calls
asterisk -rx "core show channels"
```

---

## Support Checklist

Before asking for help, collect this information:

**From Application Server:**
```bash
# Version info
node --version
npm --version
git log -1 --oneline

# Service status
systemctl status companion-telephony

# Recent logs
journalctl -u companion-telephony -n 100

# Network
netstat -tlnp | grep 4000

# Environment
cat /opt/companion/.env | grep -v API_KEY
```

**From Asterisk Server:**
```bash
# Asterisk version
asterisk -V

# Module status
asterisk -rx "module show like audiosocket"

# Dialplan
asterisk -rx "dialplan show 7000"

# Network test
telnet 87.106.74.102 4000
```

---

Good luck with your deployment! 📞🤖
