# AI Companion - Low-Latency Real-time Communication

A high-performance AI companion using OpenAI's Realtime API with WebSocket-based streaming for minimal latency. Implements the same efficient communication method from [freepbx-voice-assistant](https://github.com/shirelaktoun/freepbx-voice-assistant).

## Key Features

🚀 **Low Latency** - Direct WebSocket connection to OpenAI Realtime API
🎙️ **Voice Activity Detection** - Automatic detection of when users start/stop speaking
⚡ **Audio Streaming** - Bidirectional audio streaming with PCM16 or G.711 μ-law
🔄 **Smart Buffering** - Buffers audio until AI session is ready to prevent packet loss
✂️ **Interruption Handling** - Automatically cancels AI responses when user starts speaking
🛠️ **Function Calling** - Support for custom function calls from the AI
📊 **Real-time Events** - EventEmitter-based architecture for easy integration

## Architecture

The implementation follows the same pattern as freepbx-voice-assistant:

1. **WebSocket Connection** - Direct connection to `wss://api.openai.com/v1/realtime`
2. **Session Management** - Each session has its own WebSocket connection
3. **Audio Buffering** - Buffers incoming audio until session is initialized
4. **VAD (Voice Activity Detection)** - Server-side VAD enabled after initial greeting
5. **Event-Driven** - All events are emitted for custom handling

## Installation

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=sk-...

# Start the server
npm start
```

## Usage

### Basic Setup

```javascript
import { AIAgent } from './ai-agent.js';

const agent = new AIAgent({
    apiKey: process.env.OPENAI_API_KEY,
    voice: 'shimmer',
    temperature: 0.8,
    systemMessage: 'You are a helpful AI assistant.'
});

// Start a session
const sessionId = await agent.startSession('session-1', {
    enableGreeting: true,
    greetingText: 'Hello! How can I help you?'
});

// Send audio (base64 encoded PCM16)
agent.sendAudio(sessionId, audioBase64);

// Send text
agent.sendText(sessionId, 'What is the weather like?');

// End session
await agent.endSession(sessionId);
```

### Event Handling

```javascript
// Audio from AI
agent.on('audio-delta', ({ sessionId, audio }) => {
    // Play audio (base64 encoded PCM16)
    playAudio(audio);
});

// User started speaking (interruption)
agent.on('user-speaking', ({ sessionId }) => {
    console.log('User interrupted');
});

// Function calls
agent.on('function-call', async ({ sessionId, functionCall }) => {
    const result = await handleFunction(functionCall);
    agent.sendFunctionResult(sessionId, functionCall.call_id, result);
});

// Session ready
agent.on('session-ready', ({ sessionId, openaiSessionId }) => {
    console.log('Session initialized');
});
```

## API Reference

### AIAgent Class

#### Constructor

```javascript
new AIAgent(config)
```

**Config:**
- `apiKey` - OpenAI API key (required)
- `voice` - Voice to use (default: 'shimmer')
- `temperature` - Response temperature (default: 0.8)
- `systemMessage` - System message for AI

#### Methods

**startSession(sessionId, options)**
- Start a new AI session
- Returns: Promise<sessionId>
- Options:
  - `voice` - Voice to use
  - `systemMessage` - Custom system message
  - `temperature` - Response temperature
  - `audioFormat` - 'pcm16' or 'g711_ulaw'
  - `enableGreeting` - Send initial greeting (default: true)
  - `greetingText` - Custom greeting text
  - `tools` - Array of function definitions

**sendAudio(sessionId, audioBase64)**
- Send audio to AI (automatically buffers if session not ready)
- Audio format: Base64 encoded PCM16 or G.711 μ-law

**sendText(sessionId, text)**
- Send text message to AI

**sendFunctionResult(sessionId, functionCallId, result)**
- Send function execution result back to AI

**endSession(sessionId)**
- End an AI session
- Returns: Promise<void>

**getActiveSessions()**
- Get list of all active sessions
- Returns: Array of session info

**getSession(sessionId)**
- Get info about specific session
- Returns: Session object or null

**closeAll()**
- Close all active sessions
- Returns: Promise<void>

#### Events

- `audio-delta` - Audio chunk from AI
- `session-ready` - Session initialized and ready
- `user-speaking` - User started speaking
- `user-stopped-speaking` - User stopped speaking
- `function-call` - AI requesting function execution
- `session-ended` - Session closed
- `error` - Error occurred
- `message` - Raw message from OpenAI (all events)

## WebSocket Protocol

### Client → Server Messages

**Start Session**
```json
{
    "type": "session.start",
    "voice": "shimmer",
    "systemMessage": "You are helpful",
    "enableGreeting": true,
    "greetingText": "Hello!",
    "audioFormat": "pcm16"
}
```

**Send Audio**
```json
{
    "type": "audio.append",
    "audio": "base64_encoded_audio"
}
```

**Send Text**
```json
{
    "type": "text.send",
    "text": "Hello, how are you?"
}
```

**End Session**
```json
{
    "type": "session.end"
}
```

### Server → Client Messages

**Session Ready**
```json
{
    "type": "session.ready",
    "sessionId": "session-123",
    "openaiSessionId": "sess_abc"
}
```

**Audio Delta**
```json
{
    "type": "audio.delta",
    "sessionId": "session-123",
    "audio": "base64_encoded_audio"
}
```

**User Speaking**
```json
{
    "type": "user.speaking",
    "sessionId": "session-123"
}
```

**Error**
```json
{
    "type": "error",
    "error": "error message"
}
```

## Latency Optimization

This implementation achieves low latency through:

1. **Direct WebSocket Connection** - No intermediary servers
2. **Audio Buffering** - Prevents packet loss during initialization
3. **Server-side VAD** - Reduces round-trip time for speech detection
4. **Streaming Audio** - Audio chunks sent immediately as they arrive
5. **Interruption Handling** - Cancels responses instantly when user speaks

## Testing

1. Start the server: `npm start`
2. Open browser: `http://localhost:3000`
3. Click "Start Session" to begin
4. Type messages to interact with AI
5. Check console for detailed logs

## Health Endpoints

- `GET /` - Web-based test client
- `GET /health` - Health check and server stats
- `GET /sessions` - List active sessions

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...

# Optional
PORT=3000
VOICE=shimmer
TEMPERATURE=0.8
SYSTEM_MESSAGE=You are a helpful AI assistant.
```

## Comparison with freepbx-voice-assistant

| Feature | freepbx-voice-assistant | companion |
|---------|------------------------|-----------|
| WebSocket to OpenAI | ✅ | ✅ |
| Audio Buffering | ✅ | ✅ |
| Server VAD | ✅ | ✅ |
| Interruption Handling | ✅ | ✅ |
| Function Calling | ✅ | ✅ |
| Phone System (ARI) | ✅ | ❌ |
| Web Interface | ✅ | ✅ |
| General Purpose | ❌ | ✅ |

## License

MIT

## Credits

Communication method adapted from [freepbx-voice-assistant](https://github.com/shirelaktoun/freepbx-voice-assistant).
