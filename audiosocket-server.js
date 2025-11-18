/**
 * AI Companion - AudioSocket Server
 * Handles bidirectional audio streaming from Asterisk via AudioSocket
 * Streams audio to/from OpenAI Realtime API
 */

import net from 'net';
import { AIAgent } from './ai-agent.js';
import dotenv from 'dotenv';

dotenv.config();

const AUDIOSOCKET_PORT = process.env.AUDIOSOCKET_PORT || 9999;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE = process.env.VOICE || 'shimmer';
const TEMPERATURE = parseFloat(process.env.TEMPERATURE) || 0.8;
const SYSTEM_MESSAGE = process.env.SYSTEM_MESSAGE || 'You are a helpful AI assistant speaking on a phone call. Be concise and friendly. Keep responses brief since this is a phone conversation.';

if (!OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY in .env file');
    process.exit(1);
}

console.log('📞 AI Companion AudioSocket Server Starting...');
console.log('   Port:', AUDIOSOCKET_PORT);
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

// AudioSocket Protocol Constants
const AUDIOSOCKET_UUID = 0x01;
const AUDIOSOCKET_SLIN = 0x10;  // Signed linear audio (slin16)
const AUDIOSOCKET_HANGUP = 0x00;

// Audio conversion utilities
class AudioConverter {
    // Resample 16kHz to 24kHz (OpenAI expects 24kHz)
    static resample16to24(pcm16k) {
        // Ensure buffer has even length (Int16 = 2 bytes per sample)
        let buffer = pcm16k;
        if (buffer.length % 2 !== 0) {
            // Create new buffer with even length
            buffer = Buffer.from(buffer.slice(0, buffer.length - 1));
        }

        if (buffer.length === 0) return Buffer.alloc(0);

        const input = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        const output = new Int16Array(Math.floor(input.length * 1.5));

        // Simple linear interpolation
        for (let i = 0; i < output.length; i++) {
            const srcPos = i / 1.5;
            const srcIdx = Math.floor(srcPos);
            const frac = srcPos - srcIdx;

            if (srcIdx + 1 < input.length) {
                output[i] = input[srcIdx] * (1 - frac) + input[srcIdx + 1] * frac;
            } else {
                output[i] = input[srcIdx];
            }
        }

        return Buffer.from(output.buffer);
    }

    // Resample 24kHz to 16kHz (Asterisk slin16 is 16kHz)
    static resample24to16(pcm24k) {
        // Ensure buffer has even length (Int16 = 2 bytes per sample)
        let buffer = pcm24k;
        if (buffer.length % 2 !== 0) {
            // Create new buffer with even length
            buffer = Buffer.from(buffer.slice(0, buffer.length - 1));
        }

        if (buffer.length === 0) return Buffer.alloc(0);

        const input = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        const output = new Int16Array(Math.floor(input.length / 1.5));

        // Simple decimation with averaging
        for (let i = 0; i < output.length; i++) {
            const srcPos = i * 1.5;
            const srcIdx = Math.floor(srcPos);

            if (srcIdx < input.length) {
                output[i] = input[srcIdx];
            }
        }

        return Buffer.from(output.buffer);
    }
}

// Handle AudioSocket connection
class AudioSocketSession {
    constructor(socket) {
        this.socket = socket;
        this.sessionId = null;
        this.uuid = null;
        this.callerId = 'Unknown';
        this.isActive = false;
        this.aiAgent = aiAgent;  // Store reference to AI agent

        console.log('🔌 New AudioSocket connection');

        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('end', this.handleEnd.bind(this));
        this.socket.on('error', this.handleError.bind(this));

        // Set up AI event handlers
        this.aiAgent.on('audio', this.handleAIAudio.bind(this));
        this.aiAgent.on('transcript', this.handleTranscript.bind(this));
        this.aiAgent.on('session.ready', this.handleSessionReady.bind(this));
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
        switch (type) {
            case AUDIOSOCKET_UUID:
                // UUID packet - call identifier
                this.uuid = payload.toString('utf8');
                console.log(`📞 Call UUID: ${this.uuid}`);
                this.startAISession();
                break;

            case AUDIOSOCKET_SLIN:
                // Audio packet - signed linear 16kHz mono
                if (!this.isActive) return;

                try {
                    // Convert 16kHz to 24kHz
                    const pcm24k = AudioConverter.resample16to24(payload);

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

        try {
            // Start AI session with greeting
            await this.aiAgent.startSession(this.sessionId, {
                voice: VOICE,
                temperature: TEMPERATURE,
                systemMessage: SYSTEM_MESSAGE,
                enableGreeting: true,
                greetingText: 'Hello! This is your A I assistant. How can I help you today?'
            });

            this.isActive = true;
        } catch (error) {
            console.error('❌ Failed to start AI session:', error);
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

        try {
            // Decode base64 PCM16 24kHz from OpenAI
            const pcm24k = Buffer.from(audio, 'base64');

            // Convert to 16kHz for Asterisk
            const pcm16k = AudioConverter.resample24to16(pcm24k);

            // Send to Asterisk via AudioSocket
            this.sendAudioPacket(pcm16k);
        } catch (error) {
            console.error('❌ Failed to send audio to caller:', error);
        }
    }

    sendAudioPacket(audioData) {
        if (!this.socket || this.socket.destroyed) return;

        // AudioSocket packet: [Type(1)][Length(2)][Data]
        const packet = Buffer.allocUnsafe(3 + audioData.length);
        packet.writeUInt8(AUDIOSOCKET_SLIN, 0);
        packet.writeUInt16BE(audioData.length, 1);
        audioData.copy(packet, 3);

        this.socket.write(packet);
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

        // Send hangup packet
        if (!this.socket.destroyed) {
            const hangup = Buffer.from([AUDIOSOCKET_HANGUP, 0, 0]);
            this.socket.write(hangup);
            this.socket.end();
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
