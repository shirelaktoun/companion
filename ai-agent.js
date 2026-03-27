/**
 * AI Agent Handler - Low-latency communication with OpenAI Realtime API
 * Implements the same efficient WebSocket-based method from freepbx-voice-assistant
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class AIAgent extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.sessions = new Map();
        this.audioBuffers = new Map();
    }

    /**
     * Start a new AI session
     */
    async startSession(sessionId, options = {}) {
        console.log(`🤖 Starting AI session: ${sessionId}`);

        try {
            const ws = new WebSocket(
                'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
                {
                    headers: {
                        'Authorization': `Bearer ${this.config.apiKey}`,
                        'OpenAI-Beta': 'realtime=v1'
                    }
                }
            );

            // Store session reference
            this.sessions.set(sessionId, {
                ws,
                startTime: new Date(),
                vadEnabled: false,
                hasActiveResponse: false,
                options
            });

            // Set up WebSocket handlers
            ws.on('open', () => {
                console.log(`✅ OpenAI session connected: ${sessionId}`);
                this.initializeSession(ws, sessionId, options);
            });

            ws.on('message', (data) => {
                this.handleMessage(sessionId, data);
            });

            ws.on('close', () => {
                console.log(`🔌 OpenAI session closed: ${sessionId}`);
                this.sessions.delete(sessionId);
            });

            ws.on('error', (error) => {
                console.error(`❌ OpenAI WebSocket error (${sessionId}):`, error);
                this.emit('error', { sessionId, error });
            });

            return sessionId;

        } catch (error) {
            console.error('❌ Error starting AI session:', error);
            throw error;
        }
    }

    /**
     * Initialize OpenAI session configuration
     */
    initializeSession(ws, sessionId, options = {}) {
        const {
            voice = this.config.voice || 'shimmer',
            systemMessage = this.config.systemMessage,
            temperature = this.config.temperature || 0.8,
            tools = [],
            audioFormat = 'pcm16',
            enableGreeting = true,
            greetingText = 'Hello! How can I help you today?'
        } = options;

        console.log(`🤖 Initializing session: ${sessionId}`);
        console.log(`   Voice: ${voice}`);
        console.log(`   Audio format: ${audioFormat}`);

        // Configure session WITHOUT server_vad initially (for reliable greeting)
        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: null,  // Disabled initially
                input_audio_format: audioFormat,
                output_audio_format: audioFormat,
                voice,
                instructions: systemMessage,
                modalities: ['audio', 'text'],
                temperature,
                tools: tools || []
            }
        };

        ws.send(JSON.stringify(sessionUpdate));
        console.log('📤 Sent session configuration');

        // Send initial greeting if enabled
        if (enableGreeting) {
            console.log('📤 Sending initial greeting...');

            const conversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: greetingText
                        }
                    ]
                }
            };

            ws.send(JSON.stringify(conversationItem));

            const responseCreate = {
                type: 'response.create',
                response: {
                    modalities: ['audio', 'text']
                }
            };

            ws.send(JSON.stringify(responseCreate));
        }
    }

    /**
     * Handle OpenAI WebSocket messages
     */
    handleMessage(sessionId, data) {
        try {
            const message = JSON.parse(data.toString());

            // Log important events
            if (['session.created', 'response.done', 'error', 'input_audio_buffer.speech_started'].includes(message.type)) {
                console.log(`📩 Event (${sessionId}):`, message.type);
            }

            if (message.type === 'error') {
                console.error(`❌ OpenAI Error (${sessionId}):`, JSON.stringify(message.error, null, 2));
                this.emit('error', { sessionId, error: message.error });
                return;
            }

            // Handle interruptions - when user starts speaking, cancel ongoing response
            if (message.type === 'input_audio_buffer.speech_started') {
                console.log(`🎤 User started speaking (${sessionId})`);
                const session = this.sessions.get(sessionId);
                if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                    if (session.hasActiveResponse) {
                        session.ws.send(JSON.stringify({
                            type: 'response.cancel'
                        }));
                        console.log(`⏸️  Cancelled active response (${sessionId})`);
                        session.hasActiveResponse = false;
                    }
                    // Emit event so caller can clear audio queue
                    this.emit('user-speaking', { sessionId });
                }
                return;
            }

            // Log when speech ends
            if (message.type === 'input_audio_buffer.speech_stopped') {
                console.log(`🔇 User stopped speaking (${sessionId})`);
                this.emit('user-stopped-speaking', { sessionId });
                return;
            }

            // Handle response cancellation
            if (message.type === 'response.cancelled') {
                console.log(`🚫 Response cancelled (${sessionId})`);
                return;
            }

            // Handle response completion
            if (message.type === 'response.done') {
                console.log(`🔍 Response completed (${sessionId})`);

                const session = this.sessions.get(sessionId);
                if (session) {
                    session.hasActiveResponse = false;
                }

                // Enable server_vad after initial greeting
                if (session && !session.vadEnabled) {
                    console.log(`🎙️ Enabling server VAD (${sessionId})...`);
                    session.ws.send(JSON.stringify({
                        type: 'session.update',
                        session: {
                            turn_detection: {
                                type: 'server_vad',
                                threshold: 0.5,
                                prefix_padding_ms: 300,
                                silence_duration_ms: 500
                            }
                        }
                    }));
                    session.vadEnabled = true;

                    // Flush buffered audio after greeting
                    if (this.audioBuffers.has(sessionId)) {
                        const bufferedAudio = this.audioBuffers.get(sessionId);
                        console.log(`📦 Flushing ${bufferedAudio.length} buffered audio packets`);

                        bufferedAudio.forEach(audio => {
                            session.ws.send(JSON.stringify({
                                type: 'input_audio_buffer.append',
                                audio: audio
                            }));
                        });
                        this.audioBuffers.delete(sessionId);
                    }
                }

                // Handle function calls
                if (message.response?.output) {
                    message.response.output.forEach(item => {
                        if (item.type === 'function_call') {
                            console.log(`🔧 Function call (${sessionId}):`, item.name);
                            this.emit('function-call', { sessionId, functionCall: item });
                        }
                    });
                }
            }

            // Forward audio to caller
            if (message.type === 'response.audio.delta' && message.delta) {
                const session = this.sessions.get(sessionId);
                if (session) {
                    session.hasActiveResponse = true;
                }
                this.emit('audio-delta', { sessionId, audio: message.delta });
            }

            // Handle session created
            if (message.type === 'session.created') {
                console.log(`✅ Session created (${sessionId}):`, message.session.id);
                this.emit('session-ready', { sessionId, openaiSessionId: message.session.id });
            }

            // Emit all messages for custom handling
            this.emit('message', { sessionId, message });

        } catch (error) {
            console.error(`❌ Error handling message (${sessionId}):`, error);
        }
    }

    /**
     * Send audio to AI (with automatic buffering if session not ready)
     */
    sendAudio(sessionId, audioBase64) {
        const session = this.sessions.get(sessionId);

        if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
            // Buffer audio until session is ready
            if (!this.audioBuffers.has(sessionId)) {
                this.audioBuffers.set(sessionId, []);
            }
            this.audioBuffers.get(sessionId).push(audioBase64);

            // Limit buffer size to prevent memory issues
            const buffer = this.audioBuffers.get(sessionId);
            if (buffer.length > 150) { // ~3 seconds of 20ms packets
                buffer.shift(); // Remove oldest
            }
            return;
        }

        try {
            session.ws.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audioBase64
            }));
        } catch (error) {
            console.error(`❌ Error sending audio (${sessionId}):`, error);
        }
    }

    /**
     * Send function result back to AI
     */
    sendFunctionResult(sessionId, functionCallId, result) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
            console.error(`❌ Session not available: ${sessionId}`);
            return;
        }

        try {
            const response = {
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: functionCallId,
                    output: JSON.stringify(result)
                }
            };

            session.ws.send(JSON.stringify(response));

            session.ws.send(JSON.stringify({
                type: 'response.create',
                response: {
                    modalities: ['audio', 'text']
                }
            }));

            console.log(`✅ Function result sent (${sessionId})`);
        } catch (error) {
            console.error(`❌ Error sending function result (${sessionId}):`, error);
        }
    }

    /**
     * Send text message to AI
     */
    sendText(sessionId, text) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
            console.error(`❌ Session not available: ${sessionId}`);
            return;
        }

        try {
            const conversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text
                        }
                    ]
                }
            };

            session.ws.send(JSON.stringify(conversationItem));

            const responseCreate = {
                type: 'response.create',
                response: {
                    modalities: ['audio', 'text']
                }
            };

            session.ws.send(JSON.stringify(responseCreate));

            console.log(`📤 Text sent (${sessionId}): ${text}`);
        } catch (error) {
            console.error(`❌ Error sending text (${sessionId}):`, error);
        }
    }

    /**
     * End a session
     */
    async endSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.log(`⚠️  Session not found: ${sessionId}`);
            return;
        }

        try {
            if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                session.ws.close();
            }
            this.sessions.delete(sessionId);
            this.audioBuffers.delete(sessionId);

            const duration = Math.round((new Date() - session.startTime) / 1000);
            console.log(`✅ Session ended (${sessionId}). Duration: ${duration}s`);

            this.emit('session-ended', { sessionId, duration });
        } catch (error) {
            console.error(`❌ Error ending session (${sessionId}):`, error);
        }
    }

    /**
     * Get active sessions
     */
    getActiveSessions() {
        return Array.from(this.sessions.entries()).map(([id, data]) => ({
            sessionId: id,
            startTime: data.startTime,
            duration: Math.round((new Date() - data.startTime) / 1000),
            vadEnabled: data.vadEnabled,
            hasActiveResponse: data.hasActiveResponse
        }));
    }

    /**
     * Get session info
     */
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        return {
            sessionId,
            startTime: session.startTime,
            duration: Math.round((new Date() - session.startTime) / 1000),
            vadEnabled: session.vadEnabled,
            hasActiveResponse: session.hasActiveResponse,
            connected: session.ws && session.ws.readyState === WebSocket.OPEN
        };
    }

    /**
     * Close all sessions
     */
    async closeAll() {
        console.log('🔌 Closing all AI sessions...');

        for (const [sessionId] of this.sessions) {
            await this.endSession(sessionId);
        }

        console.log('✅ All sessions closed');
    }
}

export default AIAgent;
