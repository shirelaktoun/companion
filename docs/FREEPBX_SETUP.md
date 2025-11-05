# FreePBX/Asterisk Setup Guide

This guide provides detailed instructions for configuring FreePBX/Asterisk to work with the AI Companion Agent.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Enable Asterisk ARI](#enable-asterisk-ari)
3. [Configure HTTP Server](#configure-http-server)
4. [Create Stasis Application](#create-stasis-application)
5. [Network Configuration](#network-configuration)
6. [Testing the Setup](#testing-the-setup)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

- FreePBX or Asterisk server running
- SSH access to the server
- Root or sudo privileges
- Basic knowledge of Asterisk configuration

## Enable Asterisk ARI

### Step 1: Configure ARI

Edit the ARI configuration file:

```bash
sudo nano /etc/asterisk/ari.conf
```

Add or modify the configuration:

```ini
[general]
enabled = yes
pretty = yes
allowed_origins = *

[companion]
type = user
read_only = no
password = YourSecurePasswordHere123!
```

**Security Note**: Replace `YourSecurePasswordHere123!` with a strong password. Keep this password safe - you'll need it for the `.env` configuration.

### Step 2: Set Proper Permissions

```bash
sudo chown asterisk:asterisk /etc/asterisk/ari.conf
sudo chmod 640 /etc/asterisk/ari.conf
```

## Configure HTTP Server

Asterisk's ARI uses HTTP for communication. Configure the HTTP server:

```bash
sudo nano /etc/asterisk/http.conf
```

Add or modify:

```ini
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
tlsenable = no
tlsbindaddr = 0.0.0.0:8089
tlscertfile = /etc/asterisk/keys/asterisk.pem
tlsprivatekey = /etc/asterisk/keys/asterisk.key
enablestatic = yes
redirect = / /static/config/index.html
```

**Production Note**: For production environments, enable TLS:
- Set `tlsenable = yes`
- Generate SSL certificates
- Use port 8089 instead of 8088

### Generate SSL Certificates (Optional but Recommended)

```bash
sudo mkdir -p /etc/asterisk/keys
cd /etc/asterisk/keys
sudo openssl req -new -x509 -days 365 -nodes -out asterisk.pem -keyout asterisk.key
sudo chown asterisk:asterisk asterisk.*
sudo chmod 640 asterisk.*
```

## Create Stasis Application

### Step 1: Configure Dialplan

Edit the extensions configuration:

```bash
sudo nano /etc/asterisk/extensions.conf
```

Add this configuration at the end of the file:

```ini
[ai-companion-context]
; AI Companion Extension
exten => 7000,1,NoOp(=== AI Companion Call ===)
 same => n,Set(CALLERID(name)=${CALLERID(name)})
 same => n,Set(CALLERID(num)=${CALLERID(num)})
 same => n,Answer()
 same => n,Stasis(ai-companion,${CALLERID(num)},${CALLERID(name)})
 same => n,Hangup()

; Include this context in your main context
[from-internal]
include => ai-companion-context
```

**Note**: If you're using FreePBX GUI, you can also create a custom extension:

1. Go to **Applications** → **Extensions**
2. Create a **Custom Extension** with number 7000
3. In the **Custom Dialplan** field, add:
```
exten => 7000,1,NoOp(AI Companion)
same => n,Stasis(ai-companion)
same => n,Hangup()
```

### Step 2: Alternative - Route via Misc Destination (FreePBX GUI)

If you prefer using FreePBX web interface:

1. Go to **Admin** → **Custom Destinations**
2. Add a new destination:
   - **Target**: `Stasis(ai-companion)`
   - **Description**: `AI Companion Agent`
3. Go to **Connectivity** → **Inbound Routes**
4. Create or edit a route:
   - Set **Destination**: Select "Custom Destinations" → "AI Companion Agent"

## Network Configuration

### Firewall Rules

Allow ARI traffic through the firewall:

```bash
# For systems using firewalld
sudo firewall-cmd --permanent --add-port=8088/tcp
sudo firewall-cmd --permanent --add-port=8089/tcp
sudo firewall-cmd --reload

# For systems using iptables
sudo iptables -A INPUT -p tcp --dport 8088 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8089 -j ACCEPT
sudo service iptables save

# For systems using ufw
sudo ufw allow 8088/tcp
sudo ufw allow 8089/tcp
```

**Security Note**: If the AI Companion agent is on a different server, restrict access:

```bash
# Only allow from specific IP (replace 192.168.1.200 with your agent server IP)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.200" port port="8088" protocol="tcp" accept'
```

### Verify Network Connectivity

From the AI Companion server, test connectivity:

```bash
# Test HTTP connection
curl http://YOUR_FREEPBX_IP:8088/ari/api-docs/resources.json \
  -u companion:YourSecurePasswordHere123!

# Expected output: JSON response with API documentation
```

## Reload Asterisk Configuration

After making all changes, reload Asterisk:

```bash
# Reload all configurations
sudo asterisk -rx "core reload"

# Alternatively, reload specific modules
sudo asterisk -rx "module reload res_ari.so"
sudo asterisk -rx "module reload res_http.so"
sudo asterisk -rx "dialplan reload"
```

## Testing the Setup

### 1. Verify ARI Status

```bash
sudo asterisk -rx "ari show status"
```

Expected output:
```
ARI Status:
Enabled: Yes
Configured Applications: 1
```

### 2. Verify ARI Users

```bash
sudo asterisk -rx "ari show users"
```

Expected output should show the `companion` user.

### 3. Test ARI Endpoints

```bash
# List applications
curl http://YOUR_FREEPBX_IP:8088/ari/applications \
  -u companion:YourSecurePasswordHere123!

# Get Asterisk info
curl http://YOUR_FREEPBX_IP:8088/ari/asterisk/info \
  -u companion:YourSecurePasswordHere123!
```

### 4. Test Call Flow

1. Start the AI Companion agent on your Debian server
2. From any phone on your network, dial extension 7000
3. You should hear the AI companion greeting
4. Speak and verify the conversation works

### 5. Monitor Call in Asterisk CLI

```bash
sudo asterisk -rvvv
```

In the CLI, you should see:
```
-- Executing [7000@from-internal:1] NoOp("PJSIP/101-00000001", "AI Companion") in new stack
-- Executing [7000@from-internal:2] Stasis("PJSIP/101-00000001", "ai-companion") in new stack
```

## Advanced Configuration

### Call Recording Integration

To enable call recording:

```ini
[ai-companion-context]
exten => 7000,1,NoOp(=== AI Companion Call ===)
 same => n,Set(CHANNEL(recordingfile)=/var/spool/asterisk/monitor/companion-${UNIQUEID})
 same => n,MixMonitor(${CHANNEL(recordingfile)}.wav)
 same => n,Stasis(ai-companion)
 same => n,Hangup()
```

### Multiple Extensions

To route multiple extensions to the companion:

```ini
[ai-companion-context]
; Main companion extension
exten => 7000,1,Goto(ai-companion-handler,s,1)

; Wellness check line
exten => 7001,1,Goto(ai-companion-handler,s,1)

; Help line
exten => 7002,1,Goto(ai-companion-handler,s,1)

[ai-companion-handler]
exten => s,1,NoOp(AI Companion Handler)
 same => n,Set(COMPANION_TYPE=${EXTEN})
 same => n,Stasis(ai-companion,${COMPANION_TYPE})
 same => n,Hangup()
```

### Outbound Calling

To allow the AI Companion to make outbound calls, ensure your trunk is configured and add:

```ini
[ai-companion-outbound]
exten => _X.,1,NoOp(AI Companion Outbound)
 same => n,Set(CALLERID(num)=YOUR_CALLER_ID)
 same => n,Dial(${TRUNK}/${EXTEN})
 same => n,Hangup()
```

## Troubleshooting

### ARI Not Responding

**Check if ARI module is loaded:**
```bash
sudo asterisk -rx "module show like ari"
```

**Load ARI module if needed:**
```bash
sudo asterisk -rx "module load res_ari.so"
```

### HTTP Server Not Starting

**Check HTTP configuration:**
```bash
sudo asterisk -rx "http show status"
```

**Check for port conflicts:**
```bash
sudo netstat -tlnp | grep 8088
```

### Authentication Failures

**Verify credentials:**
```bash
sudo cat /etc/asterisk/ari.conf | grep -A 3 companion
```

**Test authentication:**
```bash
curl -v http://YOUR_IP:8088/ari/api-docs/resources.json \
  -u companion:YourPassword
```

### Stasis Application Not Found

**Check dialplan:**
```bash
sudo asterisk -rx "dialplan show ai-companion-context"
```

**Reload dialplan:**
```bash
sudo asterisk -rx "dialplan reload"
```

### Connection Timeout

**Check firewall:**
```bash
sudo firewall-cmd --list-all
# or
sudo iptables -L -n
```

**Test from companion server:**
```bash
telnet YOUR_FREEPBX_IP 8088
```

## Security Best Practices

1. **Use Strong Passwords**: Generate strong passwords for ARI users
2. **Enable TLS**: Use HTTPS/TLS for ARI connections in production
3. **Restrict Access**: Use firewall rules to limit access to trusted IPs
4. **Regular Updates**: Keep Asterisk and FreePBX updated
5. **Monitor Logs**: Regularly review Asterisk logs for suspicious activity
6. **Disable Unused Features**: Turn off features you don't need

## Monitoring

### View ARI Events

```bash
sudo asterisk -rx "ari set debug on"
```

### View HTTP Requests

```bash
sudo tail -f /var/log/asterisk/http.log
```

### View Full Logs

```bash
sudo tail -f /var/log/asterisk/full
```

## Additional Resources

- [Asterisk ARI Documentation](https://wiki.asterisk.org/wiki/display/AST/Asterisk+REST+Interface)
- [FreePBX Documentation](https://wiki.freepbx.org/)
- [Asterisk Dialplan Guide](https://wiki.asterisk.org/wiki/display/AST/Dialplan)

## Support

If you encounter issues:
1. Check Asterisk logs: `/var/log/asterisk/full`
2. Verify ARI status: `asterisk -rx "ari show status"`
3. Test network connectivity from the companion server
4. Review the troubleshooting section above
