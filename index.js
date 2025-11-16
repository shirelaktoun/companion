/**
 * AI Companion - Main Entry Point
 * Demonstrates low-latency communication with OpenAI Realtime API
 * Using the same efficient method from freepbx-voice-assistant
 */

import dotenv from 'dotenv';
import { AIAgent } from './ai-agent.js';
import http from 'http';
import { WebSocketServer } from 'ws';

// Load environment variables
dotenv.config();

// Configuration
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE = process.env.VOICE || 'shimmer';
const TEMPERATURE = parseFloat(process.env.TEMPERATURE) || 0.8;
const SYSTEM_MESSAGE = process.env.SYSTEM_MESSAGE || 'You are a helpful AI assistant. Be concise and friendly.';

// Validate configuration
if (!OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY in .env file');
    process.exit(1);
}

console.log('🚀 AI Companion Starting...');
console.log('   Port:', PORT);
console.log('   OpenAI API:', OPENAI_API_KEY ? '✅ Configured' : '❌ Missing');
console.log('   Voice:', VOICE);
console.log('   Temperature:', TEMPERATURE);
console.log('');

// Initialize AI Agent
const aiAgent = new AIAgent({
    apiKey: OPENAI_API_KEY,
    voice: VOICE,
    temperature: TEMPERATURE,
    systemMessage: SYSTEM_MESSAGE
});

// Set up event handlers for AI Agent
aiAgent.on('audio-delta', ({ sessionId, audio }) => {
    // Forward audio to connected client
    const client = wsClients.get(sessionId);
    if (client && client.readyState === 1) {
        client.send(JSON.stringify({
            type: 'audio.delta',
            sessionId,
            audio
        }));
    }
});

aiAgent.on('message', ({ sessionId, message }) => {
    const client = wsClients.get(sessionId);
    if (!client || client.readyState !== 1) return;

    // Forward text transcripts and deltas
    if (message.type === 'response.audio_transcript.delta' && message.delta) {
        client.send(JSON.stringify({
            type: 'transcript.delta',
            sessionId,
            text: message.delta
        }));
    }

    if (message.type === 'response.audio_transcript.done' && message.transcript) {
        client.send(JSON.stringify({
            type: 'transcript.done',
            sessionId,
            text: message.transcript
        }));
    }

    // Forward response.done with full details
    if (message.type === 'response.done' && message.response) {
        // Extract text from response
        let responseText = '';
        if (message.response.output) {
            message.response.output.forEach(item => {
                if (item.type === 'message' && item.content) {
                    item.content.forEach(content => {
                        if (content.type === 'text' && content.text) {
                            responseText += content.text;
                        } else if (content.type === 'audio' && content.transcript) {
                            responseText += content.transcript;
                        }
                    });
                }
            });
        }

        if (responseText) {
            client.send(JSON.stringify({
                type: 'ai.response',
                sessionId,
                text: responseText
            }));
        }
    }
});

aiAgent.on('session-ready', ({ sessionId, openaiSessionId }) => {
    console.log(`✅ Session ready: ${sessionId} (OpenAI: ${openaiSessionId})`);
    const client = wsClients.get(sessionId);
    if (client && client.readyState === 1) {
        client.send(JSON.stringify({
            type: 'session.ready',
            sessionId,
            openaiSessionId
        }));
    }
});

aiAgent.on('user-speaking', ({ sessionId }) => {
    const client = wsClients.get(sessionId);
    if (client && client.readyState === 1) {
        client.send(JSON.stringify({
            type: 'user.speaking',
            sessionId
        }));
    }
});

aiAgent.on('user-stopped-speaking', ({ sessionId }) => {
    const client = wsClients.get(sessionId);
    if (client && client.readyState === 1) {
        client.send(JSON.stringify({
            type: 'user.stopped',
            sessionId
        }));
    }
});

aiAgent.on('function-call', async ({ sessionId, functionCall }) => {
    console.log(`🔧 Function call: ${functionCall.name}`);

    // Handle function calls here
    const result = await handleFunctionCall(functionCall);

    // Send result back to AI
    aiAgent.sendFunctionResult(sessionId, functionCall.call_id, result);
});

aiAgent.on('error', ({ sessionId, error }) => {
    console.error(`❌ AI Agent Error (${sessionId}):`, error);
});

// Create HTTP server
const server = http.createServer((req, res) => {
    if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getClientHTML());
    } else if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            activeSessions: aiAgent.getActiveSessions().length,
            uptime: process.uptime()
        }));
    } else if (req.url === '/sessions' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            sessions: aiAgent.getActiveSessions()
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });
const wsClients = new Map();

wss.on('connection', (ws) => {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🔌 Client connected: ${sessionId}`);

    wsClients.set(sessionId, ws);

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'session.start':
                    // Start new AI session
                    await aiAgent.startSession(sessionId, {
                        voice: message.voice || VOICE,
                        systemMessage: message.systemMessage || SYSTEM_MESSAGE,
                        temperature: message.temperature || TEMPERATURE,
                        audioFormat: message.audioFormat || 'pcm16',
                        enableGreeting: message.enableGreeting !== false,
                        greetingText: message.greetingText,
                        tools: message.tools || []
                    });
                    break;

                case 'audio.append':
                    // Send audio to AI
                    aiAgent.sendAudio(sessionId, message.audio);
                    break;

                case 'text.send':
                    // Send text to AI
                    aiAgent.sendText(sessionId, message.text);
                    break;

                case 'session.end':
                    // End AI session
                    await aiAgent.endSession(sessionId);
                    break;

                default:
                    console.log(`⚠️  Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error('❌ Error processing client message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });

    ws.on('close', async () => {
        console.log(`🔌 Client disconnected: ${sessionId}`);
        await aiAgent.endSession(sessionId);
        wsClients.delete(sessionId);
    });

    ws.on('error', (error) => {
        console.error(`❌ WebSocket error (${sessionId}):`, error);
    });
});

// Handle function calls
async function handleFunctionCall(functionCall) {
    const { name, arguments: args } = functionCall;

    console.log(`📞 Handling function: ${name}`);
    console.log(`   Arguments:`, args);

    // Add your function handlers here
    switch (name) {
        case 'get_time':
            return {
                time: new Date().toLocaleTimeString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            };

        case 'get_date':
            return {
                date: new Date().toLocaleDateString(),
                dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' })
            };

        default:
            console.warn(`⚠️  Unknown function: ${name}`);
            return {
                error: `Function ${name} not implemented`
            };
    }
}

// Get client HTML
function getClientHTML() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>AI Companion - Test Client</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-top: 0;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin: 5px;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .status {
            margin: 20px 0;
            padding: 15px;
            background: #e9ecef;
            border-radius: 5px;
            font-family: monospace;
        }
        .log {
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
            max-height: 400px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
        }
        .log-entry {
            margin: 5px 0;
            padding: 5px;
            border-left: 3px solid #007bff;
            padding-left: 10px;
        }
        .conversation {
            margin: 20px 0;
            padding: 15px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            max-height: 400px;
            overflow-y: auto;
        }
        .message {
            margin: 10px 0;
            padding: 10px;
            border-radius: 5px;
        }
        .message.user {
            background: #007bff;
            color: white;
            margin-left: 20%;
            text-align: right;
        }
        .message.ai {
            background: #e9ecef;
            color: #333;
            margin-right: 20%;
        }
        .message .label {
            font-weight: bold;
            font-size: 12px;
            margin-bottom: 5px;
        }
        input[type="text"] {
            width: calc(100% - 100px);
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 AI Companion Test Client</h1>

        <div class="status">
            <strong>Status:</strong> <span id="status">Disconnected</span><br>
            <strong>Session:</strong> <span id="session">None</span>
        </div>

        <div>
            <button id="startBtn" onclick="startSession()">Start Session</button>
            <button id="endBtn" onclick="endSession()" disabled>End Session</button>
        </div>

        <div style="margin-top: 20px;">
            <input type="text" id="textInput" placeholder="Type a message..." onkeypress="handleKeyPress(event)">
            <button onclick="sendText()">Send Text</button>
        </div>

        <h3>Conversation</h3>
        <div class="conversation" id="conversation"></div>

        <h3>System Log</h3>
        <div class="log" id="log"></div>
    </div>

    <script>
        let ws = null;
        let sessionId = null;

        function connect() {
            ws = new WebSocket(\`ws://\${window.location.host}\`);

            ws.onopen = () => {
                log('Connected to server');
                document.getElementById('status').textContent = 'Connected';
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'session.ready':
                        log('✅ AI session ready');
                        sessionId = data.sessionId;
                        document.getElementById('session').textContent = sessionId;
                        document.getElementById('startBtn').disabled = true;
                        document.getElementById('endBtn').disabled = false;
                        break;

                    case 'ai.response':
                        log('🤖 AI: ' + data.text);
                        addMessage('ai', data.text);
                        break;

                    case 'transcript.delta':
                        // Real-time transcript streaming (optional)
                        break;

                    case 'transcript.done':
                        log('📝 Transcript: ' + data.text);
                        break;

                    case 'audio.delta':
                        // Handle audio playback here (optional)
                        break;

                    case 'user.speaking':
                        log('🎤 User speaking detected');
                        break;

                    case 'user.stopped':
                        log('🔇 User stopped speaking');
                        break;

                    case 'error':
                        log('❌ Error: ' + data.error, 'error');
                        break;

                    default:
                        // log('Received: ' + data.type);
                        break;
                }
            };

            ws.onclose = () => {
                log('Disconnected from server');
                document.getElementById('status').textContent = 'Disconnected';
                document.getElementById('startBtn').disabled = false;
                document.getElementById('endBtn').disabled = true;
                setTimeout(connect, 2000);
            };

            ws.onerror = (error) => {
                log('WebSocket error', 'error');
            };
        }

        function startSession() {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                log('Not connected', 'error');
                return;
            }

            // Clear previous conversation
            document.getElementById('conversation').innerHTML = '';

            ws.send(JSON.stringify({
                type: 'session.start',
                enableGreeting: true,
                greetingText: 'Hello! I am your AI companion. How can I help you today?'
            }));

            log('Starting AI session...');
        }

        function endSession() {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                log('Not connected', 'error');
                return;
            }

            ws.send(JSON.stringify({
                type: 'session.end'
            }));

            log('Ending session...');
            document.getElementById('startBtn').disabled = false;
            document.getElementById('endBtn').disabled = true;
            sessionId = null;
            document.getElementById('session').textContent = 'None';
        }

        function sendText() {
            const input = document.getElementById('textInput');
            const text = input.value.trim();

            if (!text) return;

            if (!ws || ws.readyState !== WebSocket.OPEN) {
                log('Not connected', 'error');
                return;
            }

            if (!sessionId) {
                log('No active session', 'error');
                return;
            }

            ws.send(JSON.stringify({
                type: 'text.send',
                text: text
            }));

            log('📤 Sent: ' + text);
            addMessage('user', text);
            input.value = '';
        }

        function addMessage(sender, text) {
            const conversationDiv = document.getElementById('conversation');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + sender;

            const labelDiv = document.createElement('div');
            labelDiv.className = 'label';
            labelDiv.textContent = sender === 'user' ? 'You' : 'AI';

            const textDiv = document.createElement('div');
            textDiv.textContent = text;

            messageDiv.appendChild(labelDiv);
            messageDiv.appendChild(textDiv);
            conversationDiv.appendChild(messageDiv);
            conversationDiv.scrollTop = conversationDiv.scrollHeight;
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendText();
            }
        }

        function log(message, level = 'info') {
            const logDiv = document.getElementById('log');
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = \`[\${new Date().toLocaleTimeString()}] \${message}\`;
            if (level === 'error') entry.style.borderLeftColor = 'red';
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        // Connect on load
        connect();
    </script>
</body>
</html>`;
}

// Start server
server.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`   Test client: http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Active sessions: http://localhost:${PORT}/sessions`);
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await aiAgent.closeAll();
    server.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down...');
    await aiAgent.closeAll();
    server.close();
    process.exit(0);
});
