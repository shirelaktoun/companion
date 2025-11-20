/**
 * AI Companion - AudioSocket Server
 * Handles bidirectional audio streaming from Asterisk via AudioSocket
 * Streams audio to/from OpenAI Realtime API
 */

import net from 'net';
import http from 'http';
import { AIAgent } from './ai-agent.js';
import dotenv from 'dotenv';

dotenv.config();

const AUDIOSOCKET_PORT = process.env.AUDIOSOCKET_PORT || 9999;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE = process.env.VOICE || 'shimmer';
const TEMPERATURE = parseFloat(process.env.TEMPERATURE) || 0.8;
const SYSTEM_MESSAGE = process.env.SYSTEM_MESSAGE || 'You are a helpful AI assistant speaking on a phone call. Be concise and friendly. Keep responses brief since this is a phone conversation.';
const WEB_SERVER_PORT = process.env.PORT || 3002;

if (!OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY in .env file');
    process.exit(1);
}

console.log('📞 AI Companion AudioSocket Server Starting...');
console.log('   Port:', AUDIOSOCKET_PORT);
console.log('   Voice:', VOICE);
console.log('   Temperature:', TEMPERATURE);
console.log('');

// AudioSocket Protocol Constants
const AUDIOSOCKET_UUID = 0x01;
const AUDIOSOCKET_SLIN = 0x10;  // Signed linear audio (format determined by call codec)
const AUDIOSOCKET_HANGUP = 0x00;

// Audio conversion utilities
class AudioConverter {
    // Resample 8kHz to 24kHz (OpenAI expects 24kHz)
    static resample8to24(pcm8k) {
        // Ensure buffer has even length and proper alignment (Int16 = 2 bytes per sample)
        let buffer = pcm8k;
        if (buffer.length % 2 !== 0) {
            buffer = buffer.slice(0, buffer.length - 1);
        }

        if (buffer.length === 0) return Buffer.alloc(0);

        // Ensure proper alignment by copying to a new buffer if byteOffset is odd
        if (buffer.byteOffset % 2 !== 0) {
            buffer = Buffer.from(buffer);
        }

        const input = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        const output = new Int16Array(input.length * 3);

        // Linear interpolation for upsampling 8kHz → 24kHz (3x)
        for (let i = 0; i < output.length; i++) {
            const srcPos = i / 3;
            const srcIdx = Math.floor(srcPos);
            const frac = srcPos - srcIdx;

            if (srcIdx + 1 < input.length) {
                output[i] = Math.round(input[srcIdx] * (1 - frac) + input[srcIdx + 1] * frac);
            } else if (srcIdx < input.length) {
                output[i] = input[srcIdx];
            }
        }

        return Buffer.from(output.buffer);
    }

    // Resample 24kHz to 8kHz (Asterisk slin/slin8 is 8kHz)
    static resample24to8(pcm24k) {
        // Ensure buffer has even length and proper alignment (Int16 = 2 bytes per sample)
        let buffer = pcm24k;
        if (buffer.length % 2 !== 0) {
            buffer = buffer.slice(0, buffer.length - 1);
        }

        if (buffer.length === 0) return Buffer.alloc(0);

        // Ensure proper alignment by copying to a new buffer if byteOffset is odd
        if (buffer.byteOffset % 2 !== 0) {
            buffer = Buffer.from(buffer);
        }

        const input = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        const outputLength = Math.floor(input.length / 3);
        const output = new Int16Array(outputLength);

        // Downsampling with anti-aliasing filter
        // 24kHz → 8kHz is a 1:3 ratio (for every 3 samples at 24kHz, we need 1 sample at 8kHz)
        // Apply a simple 5-tap FIR low-pass filter to reduce aliasing (especially for sibilants like 'S')
        const ratio = 24 / 8; // 3

        for (let i = 0; i < outputLength; i++) {
            const srcPos = i * ratio;
            const srcIdx = Math.floor(srcPos);

            // Apply simple moving average filter across 5 samples for anti-aliasing
            let sum = 0;
            let count = 0;

            for (let j = -2; j <= 2; j++) {
                const idx = srcIdx + j;
                if (idx >= 0 && idx < input.length) {
                    // Triangular window: center sample weighted more
                    const weight = (3 - Math.abs(j)) / 9;
                    sum += input[idx] * weight;
                    count += weight;
                }
            }

            output[i] = Math.round(sum / count);
        }

        return Buffer.from(output.buffer);
    }
}

/**
 * Fetch call parameters from the web server
 * @param {string} callId - Call UUID
 * @returns {Promise<Object|null>} Call parameters or null if not found
 */
function fetchCallParameters(callId) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: WEB_SERVER_PORT,
            path: `/api/call-params/${callId}`,
            method: 'GET',
            timeout: 2000
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const params = JSON.parse(data);
                        resolve(params);
                    } catch (error) {
                        console.error('❌ Failed to parse call parameters:', error);
                        resolve(null);
                    }
                } else {
                    // Parameters not found - this is normal for non-API originated calls
                    resolve(null);
                }
            });
        });

        req.on('error', (error) => {
            console.error('⚠️  Failed to fetch call parameters:', error.message);
            resolve(null);
        });

        req.on('timeout', () => {
            console.error('⚠️  Timeout fetching call parameters');
            req.destroy();
            resolve(null);
        });

        req.end();
    });
}

// Handle AudioSocket connection
class AudioSocketSession {
    constructor(socket) {
        this.socket = socket;
        this.sessionId = null;
        this.uuid = null;
        this.callerId = 'Unknown';
        this.isActive = false;

        // Create a dedicated AI agent instance for this call
        this.aiAgent = new AIAgent({
            apiKey: OPENAI_API_KEY,
            voice: VOICE,
            temperature: TEMPERATURE,
            systemMessage: SYSTEM_MESSAGE
        });

        console.log('🔌 New AudioSocket connection from', socket.remoteAddress);
        console.error('[DEBUG] AudioSocket connection established'); // Use stderr for visibility

        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('end', this.handleEnd.bind(this));
        this.socket.on('error', this.handleError.bind(this));

        // Set up AI event handlers for this specific agent instance
        this.aiAgent.on('audio-delta', this.handleAIAudio.bind(this));
        this.aiAgent.on('transcript', this.handleTranscript.bind(this));
        this.aiAgent.on('session-ready', this.handleSessionReady.bind(this));
    }

    handleData(data) {
        let offset = 0;

        while (offset < data.length) {
            // AudioSocket packet format: [Type(1)][Length(2)][Data(N)]
            if (data.length < offset + 3) break;

            const type = data.readUInt8(offset);
            const length = data.readUInt16BE(offset + 1);

            if (data.length < offset + 3 + length) break;

            const payload = data.slice(offset + 3, offset + 3 + length);
            offset += 3 + length;

            this.handlePacket(type, payload);
        }
    }

    handlePacket(type, payload) {
        console.error(`[DEBUG] handlePacket type=${type} payload length=${payload.length}`);
        switch (type) {
            case AUDIOSOCKET_UUID:
                // UUID packet - call identifier (16 bytes binary UUID)
                // Convert binary UUID to standard string format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                if (payload.length === 16) {
                    // Parse as binary UUID
                    const hex = payload.toString('hex');
                    this.uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
                } else {
                    // Fallback to UTF-8 string (for text-based UUIDs)
                    this.uuid = payload.toString('utf8');
                }
                console.log(`📞 Call UUID: ${this.uuid}`);
                console.error(`[DEBUG] Received UUID: ${this.uuid}, starting AI session...`);
                this.startAISession();
                break;

            case AUDIOSOCKET_SLIN:
                // Audio packet - signed linear 8kHz mono
                if (!this.isActive) return;

                try {
                    // Convert 8kHz to 24kHz
                    const pcm24k = AudioConverter.resample8to24(payload);

                    // Send to OpenAI
                    const base64Audio = pcm24k.toString('base64');
                    this.aiAgent.sendAudio(this.sessionId, base64Audio);
                } catch (error) {
                    console.error('❌ Audio processing error:', error);
                }
                break;

            case AUDIOSOCKET_HANGUP:
                console.log('📞 Call hangup signal received');
                this.endSession();
                break;

            default:
                console.log(`⚠️  Unknown AudioSocket packet type: 0x${type.toString(16)}`);
        }
    }

    async startAISession() {
        this.sessionId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.callerId = this.uuid || 'Unknown';

        console.log(`📞 Starting AI session for call ${this.callerId}`);
        console.error(`[DEBUG] startAISession called for UUID: ${this.uuid}`);

        try {
            // Fetch call parameters if this was an API-originated call
            console.error(`[DEBUG] Fetching call parameters...`);
            const callParams = await fetchCallParameters(this.uuid);
            console.error(`[DEBUG] Call params result:`, callParams);

            let greetingText = 'Hello! This is your A I assistant. How can I help you today?';
            let systemMessage = SYSTEM_MESSAGE;

            if (callParams) {
                console.log(`✅ Found call parameters for ${callParams.name} (${callParams.phoneNumber})`);
                greetingText = callParams.greeting || greetingText;
                systemMessage = callParams.customInstructions || systemMessage;

                // Log the customization
                console.log(`   Using custom greeting: "${greetingText}"`);
                if (callParams.customInstructions) {
                    console.log(`   Using custom instructions`);
                }
            }

            // Start AI session with greeting and custom parameters
            console.error(`[DEBUG] Starting aiAgent session...`);
            await this.aiAgent.startSession(this.sessionId, {
                voice: VOICE,
                temperature: TEMPERATURE,
                systemMessage: systemMessage,
                enableGreeting: true,
                greetingText: greetingText
            });
            console.error(`[DEBUG] aiAgent session started successfully`);

            this.isActive = true;
            console.error(`[DEBUG] Session is now active`);
        } catch (error) {
            console.error('❌ Failed to start AI session:', error);
            console.error(`[DEBUG] Error stack:`, error.stack);
            this.endSession();
        }
    }

    handleSessionReady({ sessionId }) {
        if (sessionId === this.sessionId) {
            console.log('✅ AI session ready');
        }
    }

    handleAIAudio({ sessionId, audio }) {
        if (sessionId !== this.sessionId || !this.isActive) return;

        console.log(`🔊 Received ${audio.length} bytes of audio from AI`);

        try {
            // Decode base64 PCM16 24kHz from OpenAI
            const pcm24k = Buffer.from(audio, 'base64');
            console.log(`   Decoded to ${pcm24k.length} bytes PCM24k`);

            // Convert to 8kHz for Asterisk
            const pcm8k = AudioConverter.resample24to8(pcm24k);
            console.log(`   Resampled to ${pcm8k.length} bytes PCM8k`);

            // Send to Asterisk via AudioSocket
            this.sendAudioPacket(pcm8k);
            console.log(`   ✅ Sent to Asterisk`);
        } catch (error) {
            console.error('❌ Failed to send audio to caller:', error);
        }
    }

    sendAudioPacket(audioData) {
        if (!this.socket || this.socket.destroyed) {
            console.log('   ⚠️  Socket unavailable, cannot send audio');
            return;
        }

        // Split large packets into smaller chunks to prevent Asterisk buffer overflow
        // Max 160 bytes (80 samples at 8kHz = 10ms of audio) - smaller chunks for better flow
        const MAX_CHUNK_SIZE = 160;

        for (let offset = 0; offset < audioData.length; offset += MAX_CHUNK_SIZE) {
            const chunkSize = Math.min(MAX_CHUNK_SIZE, audioData.length - offset);
            const chunk = audioData.slice(offset, offset + chunkSize);

            // AudioSocket packet: [Type(1)][Length(2)][Data]
            const packet = Buffer.allocUnsafe(3 + chunk.length);
            packet.writeUInt8(AUDIOSOCKET_SLIN, 0);
            packet.writeUInt16BE(chunk.length, 1);
            chunk.copy(packet, 3);

            // Check backpressure and send
            const flushed = this.socket.write(packet);
            if (!flushed) {
                console.log('   ⚠️  Socket buffer full, slowing down...');
            }
        }
    }

    handleTranscript({ sessionId, text, sender }) {
        if (sessionId !== this.sessionId) return;
        const icon = sender === 'user' ? '👤' : '🤖';
        console.log(`   ${icon} ${text}`);
    }

    endSession() {
        if (!this.isActive) return;

        this.isActive = false;
        console.log('📞 Call ended');

        if (this.sessionId) {
            this.aiAgent.endSession(this.sessionId);
        }

        // Send hangup packet only if socket is still writable
        if (this.socket && !this.socket.destroyed && this.socket.writable) {
            try {
                const hangup = Buffer.from([AUDIOSOCKET_HANGUP, 0, 0]);
                this.socket.write(hangup);
                this.socket.end();
            } catch (err) {
                // Socket already closed, ignore
            }
        }
    }

    handleEnd() {
        this.endSession();
    }

    handleError(error) {
        console.error('❌ AudioSocket error:', error);
        this.endSession();
    }
}

// Create AudioSocket server
const audioSocketServer = net.createServer((socket) => {
    new AudioSocketSession(socket);
});

audioSocketServer.listen(AUDIOSOCKET_PORT, '0.0.0.0', () => {
    console.log(`✅ AudioSocket server listening on 0.0.0.0:${AUDIOSOCKET_PORT}`);
    console.log(`   Extension: 7000`);
    console.log(`   Accepting connections from Asterisk server`);
    console.log(`   Ready to receive calls!`);
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\\n🛑 Shutting down AudioSocket server...');
    audioSocketServer.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\\n🛑 Shutting down AudioSocket server...');
    audioSocketServer.close();
    process.exit(0);
});
