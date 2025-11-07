# AudioSocket Setup Guide

This guide explains how to configure Asterisk to use AudioSocket for real-time audio streaming to the AI Companion.

## What is AudioSocket?

AudioSocket is an Asterisk module that allows bidirectional audio streaming over TCP. It's perfect for real-time speech-to-text applications like this AI Companion.

## Prerequisites

- FreePBX/Asterisk server
- Asterisk 16+ (AudioSocket module included)
- AI Companion installed and running

## Installation Steps

### Step 1: Verify AudioSocket Module

Check if the AudioSocket module is available:

```bash
asterisk -rx "module show like audiosocket"
```

If not loaded, load it:

```bash
asterisk -rx "module load app_audiosocket.so"
```

### Step 2: Configure Dialplan

Edit your dialplan to use AudioSocket for extension 7000. You have two options:

#### Option A: Replace existing dialplan (Recommended)

Edit `/etc/asterisk/extensions.conf` or add to `/etc/asterisk/extensions_custom.conf`:

```ini
[check-internal]
; AI Companion with AudioSocket for bidirectional audio
exten => 7000,1,NoOp(AI Companion with AudioSocket)
exten => 7000,n,Answer()
exten => 7000,n,AudioSocket(40325d0c-5e26-496b-9d77-4461c994e31e,127.0.0.1:5038)
exten => 7000,n,Hangup()
```

**Important Notes:**
- The UUID (`40325d0c-5e26-496b-9d77-4461c994e31e`) can be any UUID - it's used to identify the call
- The address `127.0.0.1:5038` must match the AudioSocket server port (default: 5038)
- AudioSocket handles the call entirely - no need for Stasis

#### Option B: Keep Stasis for call control + AudioSocket for audio

If you want to keep using Stasis for call control but add AudioSocket for audio:

```ini
[check-internal]
; AI Companion - Stasis for control, AudioSocket for audio
exten => 7000,1,NoOp(AI Companion)
exten => 7000,n,Answer()
exten => 7000,n,Stasis(ai-companion)
exten => 7000,n,Hangup()

; Note: The Stasis application would need to start AudioSocket programmatically
; This is more complex - Option A is recommended
```

### Step 3: Reload Dialplan

After making changes, reload the dialplan:

```bash
asterisk -rx "dialplan reload"
```

### Step 4: Verify Configuration

Check the dialplan:

```bash
asterisk -rx "dialplan show check-internal"
```

You should see extension 7000 with AudioSocket configured.

### Step 5: Test the Connection

1. Make sure AI Companion is running:
   ```bash
   systemctl status ai-companion
   tail -f /var/log/ai-companion/companion.log
   ```

2. You should see:
   ```
   AudioSocket server listening on port 5038
   ```

3. Call extension 7000 from your phone

4. Watch the logs - you should see:
   ```
   AudioSocket connection established: [UUID]
   Mapped AudioSocket [UUID] to channel [channel-id]
   Transcript for [channel-id]: "hello"
   ```

## Troubleshooting

### AudioSocket module not found

```bash
# Check if module exists
ls -la /usr/lib/asterisk/modules/app_audiosocket.so

# If not found, install asterisk modules
apt-get install asterisk-modules
```

### Connection refused on port 5038

```bash
# Check if AI Companion AudioSocket server is running
netstat -tuln | grep 5038

# Check firewall
ufw allow 5038/tcp
```

### No audio received

```bash
# Check logs
tail -f /var/log/ai-companion/companion.log

# Verify UUID format in dialplan
# Make sure address is 127.0.0.1:5038 (not 127.0.0.1 5038)
```

### AudioSocket connects but no transcription

Check that:
1. Deepgram API key is valid in `/opt/ai-companion/.env`
2. Server has internet access to reach Deepgram API
3. Audio format is correct (mulaw, 8kHz, mono)

## How It Works

### Call Flow

```
1. Caller dials 7000
2. Asterisk Answer()
3. Asterisk connects to AudioSocket server (AI Companion on port 5038)
4. AudioSocket sends:
   - 16-byte UUID
   - Audio frames (mulaw format, 8kHz)
5. AI Companion:
   - Receives audio
   - Maps UUID to channel ID
   - Sends audio to Deepgram for transcription
   - Generates AI response
   - Converts response to 8kHz audio
   - Plays via Asterisk sound: protocol
6. On hangup, AudioSocket disconnects
```

### AudioSocket Protocol

- **Connection**: TCP on port 5038
- **UUID**: First 16 bytes identify the call
- **Frames**:
  - 1 byte: kind (0x00=audio, 0x01=hangup)
  - 2 bytes: length (big-endian)
  - N bytes: audio data (mulaw)

## Advanced Configuration

### Custom Port

To use a different port, edit:

1. `/opt/ai-companion/src/index.ts`:
   ```typescript
   const audioSocketServer = new AudioSocketServer(YOUR_PORT, logger);
   ```

2. Dialplan:
   ```ini
   exten => 7000,n,AudioSocket(UUID,127.0.0.1:YOUR_PORT)
   ```

3. Rebuild and restart:
   ```bash
   cd /opt/ai-companion
   npm run build
   systemctl restart ai-companion
   ```

### Multiple AI Agents

You can run multiple AI agents on different extensions:

```ini
exten => 7001,1,AudioSocket(uuid1,127.0.0.1:5038)  ; Agent 1
exten => 7002,1,AudioSocket(uuid2,127.0.0.1:5039)  ; Agent 2
```

Each agent needs its own AudioSocket server instance.

## Security Considerations

- AudioSocket server binds to `0.0.0.0` by default
- Consider using firewall rules to restrict access:
  ```bash
  ufw allow from 127.0.0.1 to any port 5038
  ufw deny 5038/tcp
  ```

- For remote Asterisk servers, use VPN or SSH tunnel
- Never expose port 5038 directly to the internet

## References

- [Asterisk AudioSocket Documentation](https://wiki.asterisk.org/wiki/display/AST/AudioSocket)
- [AudioSocket Protocol Specification](https://github.com/CyCoreSystems/audiosocket)
