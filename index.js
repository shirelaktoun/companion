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
        case 'get_current_time':
            return {
                time: new Date().toLocaleTimeString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                timestamp: new Date().toISOString()
            };

        case 'get_current_date':
            return {
                date: new Date().toLocaleDateString(),
                dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
                isoDate: new Date().toISOString().split('T')[0]
            };

        case 'get_weather':
            // Demo function - in production, call a real weather API
            const location = args?.location || 'Unknown';
            return {
                location: location,
                temperature: Math.floor(Math.random() * 30) + 10, // Random temp 10-40°C
                condition: ['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy'][Math.floor(Math.random() * 4)],
                humidity: Math.floor(Math.random() * 40) + 40, // 40-80%
                note: 'This is a demo response. Integrate with a real weather API for actual data.'
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
        .audio-controls {
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .audio-indicator {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #28a745;
            display: none;
            animation: pulse 1s infinite;
        }
        .audio-indicator.speaking {
            display: inline-block;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
        }
        input[type="text"] {
            width: calc(100% - 100px);
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
        input[type="range"] {
            flex: 1;
            max-width: 200px;
        }
        .settings-panel {
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
            border: 1px solid #ddd;
        }
        .settings-panel h3 {
            margin-top: 0;
            cursor: pointer;
            user-select: none;
        }
        .settings-panel h3:before {
            content: '▼ ';
            display: inline-block;
            transition: transform 0.3s;
        }
        .settings-panel.collapsed h3:before {
            transform: rotate(-90deg);
        }
        .settings-content {
            margin-top: 15px;
        }
        .settings-panel.collapsed .settings-content {
            display: none;
        }
        .setting-row {
            margin: 10px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .setting-row label {
            min-width: 120px;
            font-weight: bold;
        }
        .setting-row select,
        .setting-row input[type="text"] {
            flex: 1;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        .setting-row textarea {
            flex: 1;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 5px;
            min-height: 80px;
            font-family: inherit;
        }
        .setting-row input[type="range"] {
            flex: 1;
        }
        .mic-button {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #007bff;
            color: white;
            border: none;
            font-size: 24px;
            cursor: pointer;
            margin: 10px auto;
            display: block;
            transition: all 0.3s;
        }
        .mic-button:hover {
            background: #0056b3;
            transform: scale(1.1);
        }
        .mic-button.recording {
            background: #dc3545;
            animation: pulse-mic 1s infinite;
        }
        @keyframes pulse-mic {
            0%, 100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
            50% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
        }
        .presets-section {
            margin: 10px 0;
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
        }
        .preset-btn {
            padding: 5px 10px;
            border: 1px solid #007bff;
            background: white;
            color: #007bff;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        .preset-btn:hover {
            background: #007bff;
            color: white;
        }
        .preset-btn.active {
            background: #007bff;
            color: white;
        }
        .export-section {
            margin-top: 20px;
            padding: 15px;
            background: #e9ecef;
            border-radius: 5px;
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

        <div class="settings-panel collapsed" id="settingsPanel">
            <h3 onclick="toggleSettings()">⚙️ AI Settings</h3>
            <div class="settings-content">
                <div class="presets-section">
                    <strong>Presets:</strong>
                    <button class="preset-btn" onclick="loadPreset('default')">Default</button>
                    <button class="preset-btn" onclick="loadPreset('professional')">Professional</button>
                    <button class="preset-btn" onclick="loadPreset('friendly')">Friendly</button>
                    <button class="preset-btn" onclick="loadPreset('technical')">Technical</button>
                    <button class="preset-btn" onclick="loadPreset('customer-service')">Customer Service</button>
                    <button class="preset-btn" onclick="saveCustomPreset()">💾 Save Custom</button>
                </div>

                <div class="setting-row">
                    <label for="languageSelect">Language:</label>
                    <select id="languageSelect">
                        <option value="en" selected>English</option>
                        <option value="es">Spanish (Español)</option>
                        <option value="fr">French (Français)</option>
                        <option value="de">German (Deutsch)</option>
                        <option value="it">Italian (Italiano)</option>
                        <option value="pt">Portuguese (Português)</option>
                        <option value="ja">Japanese (日本語)</option>
                        <option value="zh">Chinese (中文)</option>
                        <option value="ar">Arabic (العربية)</option>
                        <option value="hi">Hindi (हिन्दी)</option>
                    </select>
                </div>

                <div class="setting-row">
                    <label for="voiceSelect">Voice:</label>
                    <select id="voiceSelect">
                        <option value="shimmer" selected>Shimmer (Female)</option>
                        <option value="alloy">Alloy (Neutral)</option>
                        <option value="echo">Echo (Male)</option>
                        <option value="fable">Fable (British Male)</option>
                        <option value="onyx">Onyx (Deep Male)</option>
                        <option value="nova">Nova (Female)</option>
                    </select>
                </div>

                <div class="setting-row">
                    <label for="temperatureSlider">Temperature:</label>
                    <input type="range" id="temperatureSlider" min="0" max="100" value="80"
                           onchange="updateTemperatureLabel(this.value)">
                    <span id="temperatureLabel">0.8</span>
                </div>

                <div class="setting-row">
                    <label for="systemMessage">Personality:</label>
                    <textarea id="systemMessage" placeholder="Describe how the AI should behave...">You are a helpful AI assistant. Be concise and friendly.</textarea>
                </div>

                <div class="setting-row">
                    <label for="greetingText">Greeting:</label>
                    <input type="text" id="greetingText"
                           placeholder="Initial greeting message..."
                           value="Hello! I am your AI companion. How can I help you today?">
                </div>
            </div>
        </div>

        <div>
            <button id="startBtn" onclick="startSession()">Start Session</button>
            <button id="endBtn" onclick="endSession()" disabled>End Session</button>
        </div>

        <div class="audio-controls">
            <div class="audio-indicator" id="audioIndicator"></div>
            <span>🔊 Audio:</span>
            <button id="muteBtn" onclick="toggleMute()">Mute</button>
            <span>Volume:</span>
            <input type="range" id="volumeSlider" min="0" max="100" value="80" onchange="setVolume(this.value)">
            <span id="volumeLabel">80%</span>
        </div>

        <div style="margin-top: 20px;">
            <input type="text" id="textInput" placeholder="Type a message..." onkeypress="handleKeyPress(event)">
            <button onclick="sendText()">Send Text</button>
        </div>

        <button class="mic-button" id="micBtn" onclick="toggleMicrophone()" title="Push to talk">
            🎤
        </button>

        <h3>Conversation</h3>
        <div class="conversation" id="conversation"></div>

        <div class="export-section">
            <strong>Conversation History:</strong>
            <button onclick="exportConversation('txt')">📄 Export as TXT</button>
            <button onclick="exportConversation('json')">📋 Export as JSON</button>
            <button onclick="clearConversation()">🗑️ Clear History</button>
        </div>

        <h3>System Log</h3>
        <div class="log" id="log"></div>
    </div>

    <script>
        let ws = null;
        let sessionId = null;

        // Audio playback setup
        let audioContext = null;
        let audioQueue = [];
        let isPlaying = false;
        let isMuted = false;
        let volume = 0.8;
        let gainNode = null;

        // Microphone input setup
        let mediaRecorder = null;
        let audioStream = null;
        let isRecording = false;
        let recordingChunks = [];

        // Conversation history
        let conversationHistory = [];

        // Presets database
        const presets = {
            'default': {
                voice: 'shimmer',
                temperature: 0.8,
                systemMessage: 'You are a helpful AI assistant. Be concise and friendly.',
                greetingText: 'Hello! I am your AI companion. How can I help you today?',
                language: 'en'
            },
            'professional': {
                voice: 'echo',
                temperature: 0.6,
                systemMessage: 'You are a professional business assistant. Be formal, concise, and solution-oriented. Provide clear, actionable advice.',
                greetingText: 'Good day. I am your professional AI assistant. How may I support you with your business needs?',
                language: 'en'
            },
            'friendly': {
                voice: 'nova',
                temperature: 0.8,
                systemMessage: 'You are a friendly companion. Be warm, encouraging, and conversational. Show genuine interest in the user\'s wellbeing.',
                greetingText: 'Hey there! Great to chat with you. How\'s everything going?',
                language: 'en'
            },
            'technical': {
                voice: 'onyx',
                temperature: 0.4,
                systemMessage: 'You are a technical support specialist. Be precise, thorough, and explain technical concepts clearly. Provide code examples when relevant.',
                greetingText: 'Hello. I am your technical assistant. What technical issue can I help you resolve?',
                language: 'en'
            },
            'customer-service': {
                voice: 'shimmer',
                temperature: 0.7,
                systemMessage: 'You are a customer service representative. Be empathetic, patient, and always maintain a positive tone. Focus on resolving issues efficiently.',
                greetingText: 'Hello! Thank you for reaching out. I\'m here to help. What can I assist you with today?',
                language: 'en'
            }
        };

        // Language greetings
        const languageGreetings = {
            'en': 'Hello! How can I help you today?',
            'es': '¡Hola! ¿Cómo puedo ayudarte hoy?',
            'fr': 'Bonjour! Comment puis-je vous aider aujourd\'hui?',
            'de': 'Hallo! Wie kann ich Ihnen heute helfen?',
            'it': 'Ciao! Come posso aiutarti oggi?',
            'pt': 'Olá! Como posso ajudá-lo hoje?',
            'ja': 'こんにちは！今日はどのようにお手伝いできますか？',
            'zh': '你好！我今天能帮你什么？',
            'ar': 'مرحبا! كيف يمكنني مساعدتك اليوم؟',
            'hi': 'नमस्ते! मैं आज आपकी कैसे मदद कर सकता हूँ?'
        };

        // Initialize Web Audio API
        function initAudio() {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                gainNode = audioContext.createGain();
                gainNode.connect(audioContext.destination);
                gainNode.gain.value = volume;
                console.log('Audio context initialized');
            }
        }

        // Decode base64 PCM16 audio to AudioBuffer
        function base64ToAudioBuffer(base64) {
            // Decode base64 to binary
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // PCM16 is 16-bit signed integers, so convert bytes to Int16Array
            const pcm16 = new Int16Array(bytes.buffer);

            // Convert PCM16 to Float32Array for Web Audio API
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768.0; // Normalize to -1.0 to 1.0
            }

            // Create AudioBuffer (24kHz sample rate for PCM16 from OpenAI)
            const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
            audioBuffer.getChannelData(0).set(float32);

            return audioBuffer;
        }

        // Play audio buffer
        function playAudioBuffer(audioBuffer) {
            if (isMuted) return;

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gainNode);

            source.onended = () => {
                isPlaying = false;
                playNextAudio();
            };

            source.start(0);
            isPlaying = true;

            // Show speaking indicator
            document.getElementById('audioIndicator').classList.add('speaking');
        }

        // Add audio to queue and play if not already playing
        function queueAudio(base64Audio) {
            initAudio();

            try {
                const audioBuffer = base64ToAudioBuffer(base64Audio);
                audioQueue.push(audioBuffer);

                if (!isPlaying) {
                    playNextAudio();
                }
            } catch (error) {
                console.error('Error decoding audio:', error);
            }
        }

        // Play next audio in queue
        function playNextAudio() {
            if (audioQueue.length > 0 && !isPlaying) {
                const audioBuffer = audioQueue.shift();
                playAudioBuffer(audioBuffer);
            } else if (audioQueue.length === 0) {
                // Hide speaking indicator
                document.getElementById('audioIndicator').classList.remove('speaking');
            }
        }

        // Toggle mute
        function toggleMute() {
            isMuted = !isMuted;
            const btn = document.getElementById('muteBtn');
            btn.textContent = isMuted ? 'Unmute' : 'Mute';
            btn.style.background = isMuted ? '#dc3545' : '#007bff';

            if (isMuted) {
                // Stop current playback
                audioQueue = [];
                isPlaying = false;
                document.getElementById('audioIndicator').classList.remove('speaking');
            }
        }

        // Set volume
        function setVolume(value) {
            volume = value / 100;
            if (gainNode) {
                gainNode.gain.value = volume;
            }
            document.getElementById('volumeLabel').textContent = value + '%';
        }

        // Toggle settings panel
        function toggleSettings() {
            const panel = document.getElementById('settingsPanel');
            panel.classList.toggle('collapsed');
        }

        // Update temperature label
        function updateTemperatureLabel(value) {
            const temp = (value / 100).toFixed(2);
            document.getElementById('temperatureLabel').textContent = temp;
        }

        // Get current settings
        function getSettings() {
            const language = document.getElementById('languageSelect').value;
            return {
                voice: document.getElementById('voiceSelect').value,
                temperature: parseInt(document.getElementById('temperatureSlider').value) / 100,
                systemMessage: document.getElementById('systemMessage').value,
                greetingText: document.getElementById('greetingText').value,
                language: language
            };
        }

        // Load preset
        function loadPreset(presetName) {
            const preset = presets[presetName];
            if (!preset) {
                // Try to load from localStorage (custom preset)
                const saved = localStorage.getItem('customPreset');
                if (saved) {
                    const customPreset = JSON.parse(saved);
                    applyPreset(customPreset);
                    log('✅ Loaded custom preset');
                }
                return;
            }

            applyPreset(preset);
            log('✅ Loaded ' + presetName + ' preset');
        }

        // Apply preset to form
        function applyPreset(preset) {
            document.getElementById('voiceSelect').value = preset.voice;
            document.getElementById('temperatureSlider').value = preset.temperature * 100;
            updateTemperatureLabel(preset.temperature * 100);
            document.getElementById('systemMessage').value = preset.systemMessage;
            document.getElementById('greetingText').value = preset.greetingText;
            if (preset.language) {
                document.getElementById('languageSelect').value = preset.language;
            }
        }

        // Save custom preset
        function saveCustomPreset() {
            const settings = getSettings();
            localStorage.setItem('customPreset', JSON.stringify(settings));
            log('💾 Custom preset saved');
            alert('Custom preset saved successfully!');
        }

        // Toggle microphone
        async function toggleMicrophone() {
            if (!sessionId) {
                log('Please start a session first', 'error');
                return;
            }

            if (isRecording) {
                stopRecording();
            } else {
                await startRecording();
            }
        }

        // Start microphone recording
        async function startRecording() {
            try {
                initAudio();

                // Request microphone access
                audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        sampleRate: 24000,
                        echoCancellation: true,
                        noiseSuppression: true
                    }
                });

                // Create MediaRecorder for audio streaming
                mediaRecorder = new MediaRecorder(audioStream, {
                    mimeType: 'audio/webm;codecs=opus'
                });

                mediaRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0) {
                        // Convert to PCM16 and send to AI
                        const arrayBuffer = await event.data.arrayBuffer();
                        const audioData = await convertToPCM16(arrayBuffer);
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'audio.append',
                                audio: audioData
                            }));
                        }
                    }
                };

                // Capture audio in chunks every 100ms
                mediaRecorder.start(100);
                isRecording = true;

                document.getElementById('micBtn').classList.add('recording');
                log('🎤 Microphone recording started');

            } catch (error) {
                console.error('Microphone error:', error);
                log('❌ Microphone access denied or error: ' + error.message, 'error');
            }
        }

        // Stop microphone recording
        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }

            if (audioStream) {
                audioStream.getTracks().forEach(track => track.stop());
                audioStream = null;
            }

            isRecording = false;
            document.getElementById('micBtn').classList.remove('recording');
            log('🔇 Microphone recording stopped');
        }

        // Convert WebM audio to PCM16 base64
        async function convertToPCM16(arrayBuffer) {
            // Decode WebM to AudioBuffer
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Resample to 24kHz if needed
            const sampleRate = 24000;
            let channelData = audioBuffer.getChannelData(0);

            if (audioBuffer.sampleRate !== sampleRate) {
                // Simple resampling (you could use a library for better quality)
                const ratio = audioBuffer.sampleRate / sampleRate;
                const newLength = Math.floor(channelData.length / ratio);
                const resampled = new Float32Array(newLength);

                for (let i = 0; i < newLength; i++) {
                    const srcIndex = Math.floor(i * ratio);
                    resampled[i] = channelData[srcIndex];
                }
                channelData = resampled;
            }

            // Convert Float32 to Int16 (PCM16)
            const pcm16 = new Int16Array(channelData.length);
            for (let i = 0; i < channelData.length; i++) {
                const s = Math.max(-1, Math.min(1, channelData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Convert to base64
            const bytes = new Uint8Array(pcm16.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        }

        // Export conversation
        function exportConversation(format) {
            if (conversationHistory.length === 0) {
                alert('No conversation to export');
                return;
            }

            let content, filename, mimeType;

            if (format === 'txt') {
                content = conversationHistory.map(msg =>
                    `[${msg.timestamp}] ${msg.sender === 'user' ? 'You' : 'AI'}: ${msg.text}`
                ).join('\n\n');
                filename = `conversation_${Date.now()}.txt`;
                mimeType = 'text/plain';
            } else if (format === 'json') {
                content = JSON.stringify(conversationHistory, null, 2);
                filename = `conversation_${Date.now()}.json`;
                mimeType = 'application/json';
            }

            // Download file
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            log(`📥 Exported conversation as ${format.toUpperCase()}`);
        }

        // Clear conversation
        function clearConversation() {
            if (!confirm('Are you sure you want to clear the conversation history?')) {
                return;
            }

            conversationHistory = [];
            document.getElementById('conversation').innerHTML = '';
            log('🗑️ Conversation history cleared');
        }

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
                        // Play audio in real-time
                        if (data.audio) {
                            queueAudio(data.audio);
                        }
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

            // Clear previous conversation (but keep history)
            document.getElementById('conversation').innerHTML = '';

            // Clear audio queue
            audioQueue = [];
            isPlaying = false;
            document.getElementById('audioIndicator').classList.remove('speaking');

            // Stop any recording
            if (isRecording) {
                stopRecording();
            }

            // Initialize audio on user interaction (required by browsers)
            initAudio();

            // Get custom settings
            const settings = getSettings();

            // Add language instruction to system message
            let systemMessage = settings.systemMessage;
            if (settings.language !== 'en') {
                const languageName = document.getElementById('languageSelect').selectedOptions[0].text.split('(')[0].trim();
                systemMessage += `\n\nIMPORTANT: Respond in ${languageName} language.`;
            }

            ws.send(JSON.stringify({
                type: 'session.start',
                enableGreeting: true,
                greetingText: settings.greetingText,
                voice: settings.voice,
                temperature: settings.temperature,
                systemMessage: systemMessage,
                tools: [
                    {
                        type: 'function',
                        name: 'get_current_time',
                        description: 'Get the current time',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: []
                        }
                    },
                    {
                        type: 'function',
                        name: 'get_current_date',
                        description: 'Get the current date',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: []
                        }
                    },
                    {
                        type: 'function',
                        name: 'get_weather',
                        description: 'Get the weather for a location (demo function)',
                        parameters: {
                            type: 'object',
                            properties: {
                                location: {
                                    type: 'string',
                                    description: 'The city and state, e.g. San Francisco, CA'
                                }
                            },
                            required: ['location']
                        }
                    }
                ]
            }));

            log('Starting AI session with custom settings...');
            log(`  Voice: ${settings.voice}`);
            log(`  Temperature: ${settings.temperature}`);
            log(`  Language: ${settings.language}`);
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
            // Add to conversation history
            conversationHistory.push({
                sender,
                text,
                timestamp: new Date().toISOString()
            });

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
