/**
 * AI Companion - Telephony Server
 * Bridges phone calls to OpenAI Realtime API via Asterisk AGI
 * Extension 7000 - Dial to talk to AI assistant
 */

import net from 'net';
import { Transform } from 'stream';
import { AIAgent } from './ai-agent.js';
import dotenv from 'dotenv';

dotenv.config();

const AGI_PORT = process.env.AGI_PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE = process.env.VOICE || 'shimmer';
const TEMPERATURE = parseFloat(process.env.TEMPERATURE) || 0.8;
const SYSTEM_MESSAGE = process.env.SYSTEM_MESSAGE || 'You are a helpful AI assistant. Be concise and friendly. You are being accessed via telephone.';

// Validate configuration
if (!OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY in .env file');
    process.exit(1);
}

console.log('📞 AI Companion Telephony Server Starting...');
console.log('   AGI Port:', AGI_PORT);
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

// AGI Command Parser
class AGIParser {
    constructor() {
        this.variables = {};
        this.commandQueue = [];
    }

    parseVariable(line) {
        const match = line.match(/^agi_(\w+):\s*(.*)$/);
        if (match) {
            this.variables[match[1]] = match[2];
            return true;
        }
        return false;
    }

    parseResponse(line) {
        const match = line.match(/^(\d{3})(?:\s+result=(.*))?/);
        if (match) {
            return {
                code: parseInt(match[1]),
                result: match[2] || ''
            };
        }
        return null;
    }
}

// Audio conversion utilities
class AudioConverter {
    // Convert μ-law (8kHz mono) to PCM16 (24kHz mono) for OpenAI
    static ulawToPCM16(ulawBuffer) {
        const pcm8k = new Int16Array(ulawBuffer.length);

        // μ-law to linear PCM conversion table
        const ULAW_DECODE = AudioConverter.generateUlawDecodeTable();

        for (let i = 0; i < ulawBuffer.length; i++) {
            pcm8k[i] = ULAW_DECODE[ulawBuffer[i]];
        }

        // Resample from 8kHz to 24kHz (3x upsampling)
        return AudioConverter.resample8to24(pcm8k);
    }

    // Convert PCM16 (24kHz mono) from OpenAI to μ-law (8kHz mono)
    static pcm16ToUlaw(pcm24kBuffer) {
        // Downsample from 24kHz to 8kHz
        const pcm8k = AudioConverter.resample24to8(pcm24kBuffer);

        // Convert to μ-law
        const ulaw = new Uint8Array(pcm8k.length);
        for (let i = 0; i < pcm8k.length; i++) {
            ulaw[i] = AudioConverter.linearToUlaw(pcm8k[i]);
        }

        return Buffer.from(ulaw);
    }

    // Simple 3x downsampling (24kHz -> 8kHz)
    static resample24to8(pcm24k) {
        const samples24 = new Int16Array(pcm24k.buffer || pcm24k);
        const samples8 = new Int16Array(Math.floor(samples24.length / 3));

        for (let i = 0; i < samples8.length; i++) {
            samples8[i] = samples24[i * 3];
        }

        return samples8;
    }

    // Simple 3x upsampling (8kHz -> 24kHz)
    static resample8to24(pcm8k) {
        const samples24 = new Int16Array(pcm8k.length * 3);

        for (let i = 0; i < pcm8k.length; i++) {
            samples24[i * 3] = pcm8k[i];
            samples24[i * 3 + 1] = pcm8k[i];
            samples24[i * 3 + 2] = pcm8k[i];
        }

        return Buffer.from(samples24.buffer);
    }

    // Linear PCM to μ-law conversion
    static linearToUlaw(sample) {
        const BIAS = 0x84;
        const CLIP = 32635;

        let sign = (sample >> 8) & 0x80;
        if (sign) sample = -sample;
        if (sample > CLIP) sample = CLIP;

        sample = sample + BIAS;
        let exponent = AudioConverter.exp_lut[(sample >> 7) & 0xFF];
        let mantissa = (sample >> (exponent + 3)) & 0x0F;
        let ulawbyte = ~(sign | (exponent << 4) | mantissa);

        return ulawbyte & 0xFF;
    }

    static generateUlawDecodeTable() {
        const table = new Int16Array(256);
        for (let i = 0; i < 256; i++) {
            const inv = ~i;
            const sign = inv & 0x80;
            const exponent = (inv >> 4) & 0x07;
            const mantissa = inv & 0x0F;
            const step = 4 << (exponent + 1);
            let value = (0x80 + (mantissa << (exponent + 3)));
            if (sign) value = -value;
            table[i] = value;
        }
        return table;
    }

    static exp_lut = [0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
                      5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
                      6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
                      6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
                      7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
                      7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
                      7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
                      7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7];
}

// Handle AGI connection from Asterisk
class AGISession {
    constructor(socket) {
        this.socket = socket;
        this.parser = new AGIParser();
        this.sessionId = null;
        this.aiAgent = aiAgent;
        this.buffer = '';
        this.isReady = false;

        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('end', this.handleEnd.bind(this));
        this.socket.on('error', this.handleError.bind(this));
    }

    handleData(data) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\\n');
        this.buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.trim() === '') {
                if (!this.isReady) {
                    this.isReady = true;
                    this.onReady();
                }
                continue;
            }

            if (!this.isReady) {
                this.parser.parseVariable(line);
            }
        }
    }

    async onReady() {
        const callerNum = this.parser.variables.callerid || 'Unknown';
        console.log(`📞 Call from ${callerNum}`);

        try {
            // Answer the call
            await this.sendCommand('ANSWER');

            // Set up audio streaming
            await this.sendCommand('SET VARIABLE AUDIOSOCKET_PORT 9999');

            // Start AI session
            this.sessionId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Register event handlers
            this.aiAgent.on('audio', this.handleAIAudio.bind(this));
            this.aiAgent.on('transcript', this.handleTranscript.bind(this));

            // Start AI session with greeting
            this.aiAgent.startSession(this.sessionId, {
                voice: VOICE,
                temperature: TEMPERATURE,
                systemMessage: SYSTEM_MESSAGE,
                enableGreeting: true,
                greetingText: 'Hello! This is your AI assistant. How can I help you today?'
            });

            // Stream audio via AudioSocket
            await this.sendCommand('EXEC AudioSocket 127.0.0.1:9999,ai-companion');

        } catch (error) {
            console.error('❌ AGI Error:', error);
            await this.sendCommand('HANGUP');
        }
    }

    handleAIAudio({ sessionId, audio }) {
        if (sessionId !== this.sessionId) return;

        // Convert PCM16 24kHz to μ-law 8kHz and send to caller
        try {
            const audioBuffer = Buffer.from(audio, 'base64');
            const ulawAudio = AudioConverter.pcm16ToUlaw(audioBuffer);
            // Audio will be sent via AudioSocket connection
        } catch (error) {
            console.error('❌ Audio conversion error:', error);
        }
    }

    handleTranscript({ sessionId, text, sender }) {
        if (sessionId !== this.sessionId) return;
        console.log(`   ${sender === 'user' ? '👤' : '🤖'} ${text}`);
    }

    sendCommand(cmd) {
        return new Promise((resolve, reject) => {
            this.socket.write(cmd + '\\n', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    handleEnd() {
        console.log('📞 Call ended');
        if (this.sessionId) {
            this.aiAgent.endSession(this.sessionId);
        }
    }

    handleError(error) {
        console.error('❌ AGI Socket error:', error);
    }
}

// Create AGI server
const agiServer = net.createServer((socket) => {
    console.log('🔌 New AGI connection');
    new AGISession(socket);
});

agiServer.listen(AGI_PORT, () => {
    console.log(`✅ Telephony server listening on port ${AGI_PORT}`);
    console.log(`   Extension: 7000`);
    console.log(`   Ready to receive calls!`);
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\\n🛑 Shutting down telephony server...');
    agiServer.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\\n🛑 Shutting down telephony server...');
    agiServer.close();
    process.exit(0);
});
