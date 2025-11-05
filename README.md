# AI Companion PBX Agent

An intelligent AI companion agent that integrates with FreePBX/Asterisk to handle phone calls with natural conversation, wellbeing checks, and helpful assistance.

## Features

- 🤖 **AI-Powered Conversations**: Uses Claude AI for natural, empathetic conversations
- 📞 **Full Call Handling**: Manages both incoming and outgoing calls via Asterisk ARI
- 🗣️ **Real-time Speech Recognition**: Converts speech to text using Deepgram
- 🔊 **High-Quality Voice Synthesis**: Supports OpenAI TTS (recommended) and Google Cloud TTS
- 💚 **Wellbeing Monitoring**: Analyzes conversations for wellbeing concerns
- 🔄 **Automatic Reconnection**: Handles network interruptions gracefully
- 📊 **Comprehensive Logging**: Detailed logs for debugging and monitoring
- 🚀 **Production Ready**: Includes systemd service and deployment scripts for Debian 13

## Architecture

```
┌─────────────┐
│   Caller    │
└──────┬──────┘
       │
       ├──────► FreePBX/Asterisk Server
       │                │
       │                │ ARI Protocol
       │                ▼
       │        ┌───────────────────┐
       │        │  AI Companion     │
       │        │  Agent (Debian)   │
       │        └────────┬──────────┘
       │                 │
       │        ┌────────┼────────┐
       │        │        │        │
       │     ┌──▼──┐ ┌──▼──┐ ┌──▼───┐
       │     │ STT │ │ TTS │ │Claude│
       │     └─────┘ └─────┘ └──────┘
       │    Deepgram OpenAI   API
       │             or Google
```

## Prerequisites

### System Requirements
- **Debian 13** (or compatible Linux distribution)
- **Node.js 18.x** or higher
- **2GB+ RAM** recommended
- Network connectivity to FreePBX/Asterisk server

### External Services & API Keys

You will need API keys for these services:

1. **FreePBX/Asterisk Server** with ARI enabled
2. **Anthropic API Key** ([Sign up here](https://console.anthropic.com/)) - For Claude AI
3. **Deepgram API Key** ([Sign up here](https://console.deepgram.com/)) - For speech-to-text
4. **Choose ONE for Text-to-Speech**:
   - **OpenAI API Key** ([Sign up here](https://platform.openai.com/)) - **Recommended** for high-quality, natural voices
   - OR **Google Cloud Account** with Text-to-Speech API enabled

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd companion
```

### 2. Configure FreePBX/Asterisk

On your FreePBX/Asterisk server:

**Enable ARI** - Edit `/etc/asterisk/ari.conf`:
```ini
[general]
enabled = yes
pretty = yes

[companion]
type = user
read_only = no
password = your_secure_password_here
```

**Configure HTTP Server** - Edit `/etc/asterisk/http.conf`:
```ini
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
```

**Create Stasis Application** - Edit `/etc/asterisk/extensions.conf`:
```ini
[from-internal]
exten => 7000,1,NoOp(AI Companion)
 same => n,Stasis(ai-companion)
 same => n,Hangup()
```

**Restart Asterisk**:
```bash
asterisk -rx "core reload"
```

### 3. Install on Debian Server

```bash
# Run the installation script as root
sudo ./scripts/install.sh
```

### 4. Configure the Agent

Edit `/opt/ai-companion/.env`:

```bash
# Asterisk/FreePBX Configuration
ASTERISK_HOST=192.168.1.100        # Your FreePBX IP
ASTERISK_PORT=8088
ASTERISK_USERNAME=companion
ASTERISK_PASSWORD=your_password_here
ASTERISK_APP_NAME=ai-companion

# AI Configuration
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Speech-to-Text
DEEPGRAM_API_KEY=your_deepgram_key_here

# Text-to-Speech Provider (choose one)
TTS_PROVIDER=openai                # or 'google'

# OpenAI TTS (Recommended)
OPENAI_API_KEY=sk-proj-your-openai-key-here
TTS_VOICE_NAME=nova                # Options: alloy, echo, fable, onyx, nova, shimmer

# OR Google Cloud TTS (if TTS_PROVIDER=google)
# GOOGLE_APPLICATION_CREDENTIALS=/opt/ai-companion/google-credentials.json
# TTS_VOICE_NAME=en-US-Neural2-J
```

### 5. Start the Service

```bash
# Start the service
sudo systemctl start ai-companion

# Enable auto-start on boot
sudo systemctl enable ai-companion

# Check status
sudo systemctl status ai-companion

# View logs
sudo journalctl -u ai-companion -f
```

## Voice Options

### OpenAI TTS Voices (Recommended)

OpenAI provides high-quality, natural-sounding voices:

- **alloy** - Neutral, balanced voice
- **echo** - Warm, friendly voice
- **fable** - Expressive, storytelling voice
- **onyx** - Deep, authoritative voice (male)
- **nova** - Warm, engaging voice (female) - **Default**
- **shimmer** - Clear, bright voice

Set via `TTS_VOICE_NAME=nova` in `.env`

### Google Cloud TTS Voices

Google offers Neural2 voices for natural speech:

- **en-US-Neural2-J** - Male voice
- **en-US-Neural2-F** - Female voice
- **en-US-Neural2-A** - Male voice (alternative)
- And many more...

Set via `TTS_VOICE_NAME=en-US-Neural2-J` in `.env`

## Usage

### Incoming Calls

Once configured, the AI companion will automatically answer calls to extension 7000 (or your configured extension) and engage in conversation with callers.

### Conversation Flow

1. Caller dials the extension (e.g., 7000)
2. AI companion answers and greets the caller
3. Conversation proceeds naturally with:
   - Active listening and empathy
   - Wellbeing check-ins
   - Helpful assistance
   - Natural pauses and acknowledgments
4. Call ends when either party hangs up

## Configuration Options

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ASTERISK_HOST` | FreePBX/Asterisk server IP | - | ✓ |
| `ASTERISK_PORT` | ARI HTTP port | `8088` | ✓ |
| `ASTERISK_USERNAME` | ARI username | - | ✓ |
| `ASTERISK_PASSWORD` | ARI password | - | ✓ |
| `ASTERISK_APP_NAME` | Stasis app name | `ai-companion` | ✓ |
| `ANTHROPIC_API_KEY` | Claude API key | - | ✓ |
| `ANTHROPIC_MODEL` | Claude model | `claude-3-5-sonnet-20241022` | |
| `DEEPGRAM_API_KEY` | Deepgram API key | - | ✓ |
| `TTS_PROVIDER` | TTS provider | `openai` | |
| `OPENAI_API_KEY` | OpenAI API key | - | If using OpenAI TTS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud key path | - | If using Google TTS |
| `TTS_VOICE_NAME` | Voice name | `nova` | |
| `TTS_LANGUAGE_CODE` | Language code | `en-US` | |
| `AGENT_NAME` | Agent's name | `Companion` | |
| `AGENT_PERSONALITY` | Agent personality | `friendly and caring` | |
| `CALL_TIMEOUT_SECONDS` | Max call duration | `300` | |
| `MAX_SILENCE_DURATION` | Silence timeout (sec) | `10` | |
| `LOG_LEVEL` | Logging level | `info` | |

## Development

### Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

### Project Structure

```
companion/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config.ts             # Configuration loader
│   ├── logger.ts             # Logging setup
│   ├── types/
│   │   └── index.ts          # TypeScript types
│   └── services/
│       ├── asterisk-client.ts    # Asterisk ARI client
│       ├── speech-to-text.ts     # Deepgram STT
│       ├── text-to-speech.ts     # Multi-provider TTS
│       ├── ai-agent.ts           # Claude AI integration
│       └── call-manager.ts       # Call orchestration
├── deployment/
│   └── ai-companion.service  # Systemd service file
├── scripts/
│   ├── install.sh            # Installation script
│   ├── uninstall.sh          # Uninstallation script
│   └── update.sh             # Update script
└── docs/
    └── FREEPBX_SETUP.md      # Detailed FreePBX guide
```

## Monitoring

### View Logs

```bash
# Real-time logs
sudo journalctl -u ai-companion -f

# Last 100 lines
sudo journalctl -u ai-companion -n 100

# Today's logs
sudo journalctl -u ai-companion --since today

# Log file
sudo tail -f /var/log/ai-companion/companion.log
```

### Service Management

```bash
# Check status
sudo systemctl status ai-companion

# Restart service
sudo systemctl restart ai-companion

# Stop service
sudo systemctl stop ai-companion
```

## Troubleshooting

### Connection Issues

**Problem**: Can't connect to Asterisk

**Solutions**:
- Check Asterisk is running: `asterisk -rx "core show version"`
- Verify ARI is enabled: `asterisk -rx "ari show status"`
- Check firewall allows port 8088
- Verify credentials in `.env`

### TTS Issues

**Problem**: No audio or voice playback

**Solutions**:
- Verify your TTS provider API key is correct
- Check `TTS_PROVIDER` is set to `openai` or `google`
- For OpenAI: Ensure `OPENAI_API_KEY` is valid
- For Google: Verify `GOOGLE_APPLICATION_CREDENTIALS` path exists
- Review logs: `journalctl -u ai-companion | grep TTS`

### STT Issues

**Problem**: Speech not being recognized

**Solutions**:
- Verify Deepgram API key
- Check network connectivity to Deepgram
- Review logs: `journalctl -u ai-companion | grep STT`

## API Keys & Costs

### Required Services

1. **Anthropic Claude API**
   - Sign up: https://console.anthropic.com/
   - Pricing: Pay per token (~$3 per million input tokens, ~$15 per million output tokens for Claude 3.5 Sonnet)
   - Free tier: $5 credit for new users

2. **Deepgram**
   - Sign up: https://console.deepgram.com/
   - Free tier: 45,000 minutes/year
   - Pricing: ~$0.0043/minute after free tier

3. **OpenAI TTS** (Recommended)
   - Console: https://platform.openai.com/
   - Pricing: $15/million characters (HD quality)
   - Very cost-effective for phone calls

4. **Google Cloud TTS** (Alternative)
   - Console: https://console.cloud.google.com/
   - Free tier: 1 million characters/month
   - Pricing: ~$16/million characters (Neural2 voices)

## Security Considerations

- Store API keys securely in `/opt/ai-companion/.env` (mode 600)
- Use firewall rules to restrict Asterisk ARI access
- Enable HTTPS for ARI connections in production
- Regularly update dependencies: `npm audit fix`
- Monitor logs for suspicious activity
- Consider encryption for sensitive conversations

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Create a GitHub issue
- Check the documentation in `docs/` directory

## Acknowledgments

- Built with [Anthropic Claude](https://www.anthropic.com/)
- Speech recognition by [Deepgram](https://deepgram.com/)
- Voice synthesis by [OpenAI](https://openai.com/) or [Google Cloud](https://cloud.google.com/text-to-speech)
- Telephony via [Asterisk](https://www.asterisk.org/)