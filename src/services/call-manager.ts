import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { CallState, ConversationMessage, AgentConfig } from '../types';
import { AsteriskClient } from './asterisk-client';
import { SpeechToTextService } from './speech-to-text';
import { TextToSpeechService } from './text-to-speech';
import { AIAgent } from './ai-agent';
import { AudioSocketServer } from './audiosocket-server';
import os from 'os';

/**
 * Call Manager orchestrates all services to handle phone calls
 */
export class CallManager extends EventEmitter {
  private asteriskClient: AsteriskClient;
  private sttService: SpeechToTextService;
  private ttsService: TextToSpeechService;
  private aiAgent: AIAgent;
  private logger: Logger;
  private config: AgentConfig;
  private audioSocketServer: AudioSocketServer;

  private activeCalls: Map<string, CallState> = new Map();
  private silenceTimers: Map<string, NodeJS.Timeout> = new Map();
  private transcriptBuffers: Map<string, string> = new Map();
  private channelToAudioSocket: Map<string, string> = new Map(); // Maps channelId -> audioSocketCallId
  private audioSocketToChannel: Map<string, string> = new Map(); // Maps audioSocketCallId -> channelId

  constructor(
    asteriskClient: AsteriskClient,
    sttService: SpeechToTextService,
    ttsService: TextToSpeechService,
    aiAgent: AIAgent,
    config: AgentConfig,
    logger: Logger,
    audioSocketServer: AudioSocketServer
  ) {
    super();
    this.asteriskClient = asteriskClient;
    this.sttService = sttService;
    this.ttsService = ttsService;
    this.aiAgent = aiAgent;
    this.config = config;
    this.logger = logger;
    this.audioSocketServer = audioSocketServer;

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for all services
   */
  private setupEventHandlers(): void {
    // Asterisk events
    this.asteriskClient.on('call-answered', async (data) => {
      await this.handleCallAnswered(data);
    });

    this.asteriskClient.on('hangup', (data) => {
      this.handleHangup(data.channelId);
    });

    this.asteriskClient.on('channel-destroyed', (data) => {
      this.handleHangup(data.channelId);
    });

    // STT events
    this.sttService.on('transcript', (data) => {
      this.handleTranscript(data);
    });

    this.sttService.on('utterance-end', (data) => {
      this.handleUtteranceEnd(data.channelId);
    });

    this.sttService.on('speech-started', (data) => {
      this.handleSpeechStarted(data.channelId);
    });

    // AudioSocket events
    this.audioSocketServer.on('connection', (data) => {
      this.handleAudioSocketConnection(data.callId);
    });

    this.audioSocketServer.on('audio', (data) => {
      this.handleAudioSocketAudio(data.callId, data.audioData);
    });

    this.audioSocketServer.on('end', (data) => {
      this.handleAudioSocketEnd(data.callId);
    });
  }

  /**
   * Handle incoming call answered
   */
  private async handleCallAnswered(data: {
    channelId: string;
    callerId: string;
    callerName: string;
  }): Promise<void> {
    try {
      this.logger.info(`Handling answered call for channel ${data.channelId}`);

      // Create call state
      const callState: CallState = {
        channelId: data.channelId,
        callerId: data.callerId,
        callerName: data.callerName,
        startTime: new Date(),
        conversationHistory: [],
        currentSpeech: '',
        isActive: true
      };

      this.activeCalls.set(data.channelId, callState);
      this.transcriptBuffers.set(data.channelId, '');

      // Start speech-to-text
      await this.sttService.startTranscription(data.channelId);

      // Generate and speak greeting
      const greeting = await this.aiAgent.generateResponse([]);
      await this.speakToChannel(data.channelId, greeting);

      // Add greeting to conversation history
      callState.conversationHistory.push({
        role: 'assistant',
        content: greeting,
        timestamp: new Date()
      });

      // Start silence monitoring
      this.startSilenceTimer(data.channelId);

    } catch (error) {
      this.logger.error(`Error handling answered call for ${data.channelId}:`, error);
      await this.asteriskClient.hangup(data.channelId);
    }
  }

  /**
   * Handle transcript from STT
   */
  private handleTranscript(data: {
    channelId: string;
    transcript: string;
    isFinal: boolean;
    confidence: number;
  }): void {
    const callState = this.activeCalls.get(data.channelId);
    if (!callState) return;

    this.logger.debug(`Transcript for ${data.channelId}: ${data.transcript} (final: ${data.isFinal})`);

    // Buffer the transcript
    const currentBuffer = this.transcriptBuffers.get(data.channelId) || '';

    if (data.isFinal) {
      // Append final transcript to buffer
      const fullTranscript = (currentBuffer + ' ' + data.transcript).trim();
      this.transcriptBuffers.set(data.channelId, fullTranscript);

      // Reset silence timer
      this.startSilenceTimer(data.channelId);
    }
  }

  /**
   * Handle utterance end (user finished speaking)
   */
  private async handleUtteranceEnd(channelId: string): Promise<void> {
    const callState = this.activeCalls.get(channelId);
    if (!callState) return;

    const transcript = this.transcriptBuffers.get(channelId) || '';

    if (transcript.trim().length === 0) {
      this.logger.debug(`Utterance end but no transcript for ${channelId}`);
      return;
    }

    this.logger.info(`User finished speaking on ${channelId}: "${transcript}"`);

    // Clear transcript buffer
    this.transcriptBuffers.set(channelId, '');

    // Add to conversation history
    callState.conversationHistory.push({
      role: 'user',
      content: transcript,
      timestamp: new Date()
    });

    // Generate AI response
    try {
      const response = await this.aiAgent.generateResponse(
        callState.conversationHistory,
        transcript
      );

      // Add AI response to history
      callState.conversationHistory.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });

      // Speak the response - check if AudioSocket or regular channel
      const isAudioSocket = this.audioSocketToChannel.has(channelId);
      if (isAudioSocket) {
        await this.speakToAudioSocket(channelId, response);
      } else {
        await this.speakToChannel(channelId, response);
      }

    } catch (error) {
      this.logger.error(`Error generating response for ${channelId}:`, error);

      const isAudioSocket = this.audioSocketToChannel.has(channelId);
      const errorMessage = "I'm sorry, I'm having trouble responding. Could you say that again?";

      if (isAudioSocket) {
        await this.speakToAudioSocket(channelId, errorMessage);
      } else {
        await this.speakToChannel(channelId, errorMessage);
      }
    }
  }

  /**
   * Handle speech started
   */
  private handleSpeechStarted(channelId: string): void {
    // Clear silence timer when user starts speaking
    this.clearSilenceTimer(channelId);
  }

  /**
   * Start silence monitoring timer
   */
  private startSilenceTimer(channelId: string): void {
    // Clear existing timer
    this.clearSilenceTimer(channelId);

    // Set new timer
    const timer = setTimeout(async () => {
      await this.handleSilence(channelId);
    }, this.config.maxSilenceDuration * 1000);

    this.silenceTimers.set(channelId, timer);
  }

  /**
   * Clear silence timer
   */
  private clearSilenceTimer(channelId: string): void {
    const timer = this.silenceTimers.get(channelId);
    if (timer) {
      clearTimeout(timer);
      this.silenceTimers.delete(channelId);
    }
  }

  /**
   * Handle prolonged silence
   */
  private async handleSilence(channelId: string): Promise<void> {
    const callState = this.activeCalls.get(channelId);
    if (!callState) return;

    this.logger.info(`Silence detected on channel ${channelId}`);

    try {
      const prompt = await this.aiAgent.generateSilencePrompt(callState.conversationHistory);

      // Check if AudioSocket or regular channel
      const isAudioSocket = this.audioSocketToChannel.has(channelId);
      if (isAudioSocket) {
        await this.speakToAudioSocket(channelId, prompt);
      } else {
        await this.speakToChannel(channelId, prompt);
      }

      // Restart silence timer
      this.startSilenceTimer(channelId);

    } catch (error) {
      this.logger.error(`Error handling silence for ${channelId}:`, error);
    }
  }

  /**
   * Speak text to a channel via Asterisk sound: protocol
   */
  private async speakToChannel(channelId: string, text: string): Promise<void> {
    try {
      this.logger.info(`Speaking to ${channelId}: "${text}"`);

      // Generate audio file in audio cache directory
      // Returns just the filename without extension
      const audioFilename = await this.ttsService.synthesize(text, channelId);

      this.logger.debug(`Audio file created: ${audioFilename}`);

      // Use sound: prefix with ai-companion subdirectory for Asterisk playback
      // The audio-cache directory is symlinked to /var/lib/asterisk/sounds/en/ai-companion
      const soundUri = `sound:ai-companion/${audioFilename}`;
      this.logger.debug(`Playing sound URI: ${soundUri}`);

      // Play audio through Asterisk using sound: prefix
      await this.asteriskClient.playAudio(channelId, soundUri);

      // Clean up audio file after a delay
      setTimeout(async () => {
        await this.ttsService.deleteFile(audioFilename);
      }, 60000); // Delete after 1 minute

    } catch (error) {
      this.logger.error(`Error speaking to channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Speak text to an AudioSocket connection
   */
  private async speakToAudioSocket(callId: string, text: string): Promise<void> {
    try {
      this.logger.info(`Speaking to AudioSocket ${callId}: "${text}"`);

      // Generate audio file (already in 8kHz mulaw format after conversion)
      const audioFilename = await this.ttsService.synthesize(text, callId);
      const audioPath = `/opt/ai-companion/audio-cache/${audioFilename}.wav`;

      this.logger.debug(`Audio file created for AudioSocket: ${audioPath}`);

      // Read the audio file
      const fs = require('fs');
      const audioBuffer = fs.readFileSync(audioPath);

      // Skip WAV header (44 bytes) to get raw PCM data
      const rawAudio = audioBuffer.slice(44);

      // Send audio through AudioSocket in chunks
      const chunkSize = 160; // 20ms of audio at 8kHz mulaw (160 bytes)
      for (let i = 0; i < rawAudio.length; i += chunkSize) {
        const chunk = rawAudio.slice(i, Math.min(i + chunkSize, rawAudio.length));
        this.audioSocketServer.sendAudio(callId, chunk);

        // Small delay to simulate real-time playback (20ms per chunk)
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      this.logger.debug(`Finished playing audio to AudioSocket ${callId}`);

      // Clean up audio file after a delay
      setTimeout(async () => {
        await this.ttsService.deleteFile(audioFilename);
      }, 60000); // Delete after 1 minute

    } catch (error) {
      this.logger.error(`Error speaking to AudioSocket ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Handle call hangup
   */
  private async handleHangup(channelId: string): Promise<void> {
    this.logger.info(`Call ended for channel ${channelId}`);

    const callState = this.activeCalls.get(channelId);
    if (!callState) return;

    // Clear timers
    this.clearSilenceTimer(channelId);

    // Stop transcription
    await this.sttService.stopTranscription(channelId);

    // Mark call as inactive
    callState.isActive = false;

    // Log conversation summary
    const duration = (Date.now() - callState.startTime.getTime()) / 1000;
    this.logger.info(`Call summary for ${channelId}:`);
    this.logger.info(`  Duration: ${duration.toFixed(0)} seconds`);
    this.logger.info(`  Messages: ${callState.conversationHistory.length}`);

    // Analyze wellbeing (optional)
    try {
      const analysis = await this.aiAgent.analyzeWellbeing(callState.conversationHistory);
      if (analysis.concernLevel !== 'none') {
        this.logger.warn(`Wellbeing concern (${analysis.concernLevel}) for caller ${callState.callerId}`);
        this.logger.warn(`Suggestions: ${analysis.suggestions.join(', ')}`);
      }
    } catch (error) {
      this.logger.error('Error analyzing wellbeing:', error);
    }

    // Clean up
    this.activeCalls.delete(channelId);
    this.transcriptBuffers.delete(channelId);

    this.emit('call-ended', {
      channelId,
      callerId: callState.callerId,
      duration,
      messageCount: callState.conversationHistory.length
    });
  }

  /**
   * Initiate an outgoing call
   */
  async makeCall(destination: string, callerId?: string): Promise<string> {
    try {
      this.logger.info(`Initiating outgoing call to ${destination}`);
      const channelId = await this.asteriskClient.makeCall(destination, callerId);
      return channelId;
    } catch (error) {
      this.logger.error(`Error making call to ${destination}:`, error);
      throw error;
    }
  }

  /**
   * Get active call count
   */
  getActiveCallCount(): number {
    return this.activeCalls.size;
  }

  /**
   * Get call state
   */
  getCallState(channelId: string): CallState | undefined {
    return this.activeCalls.get(channelId);
  }

  /**
   * Handle AudioSocket connection (incoming audio stream)
   * When using AudioSocket in dialplan, this replaces the Stasis call-answered event
   */
  private async handleAudioSocketConnection(callId: string): Promise<void> {
    this.logger.info(`AudioSocket connection established: ${callId}`);

    // Create a call state for this AudioSocket connection
    // Use the AudioSocket UUID as both the channel ID and call ID
    const callState: CallState = {
      channelId: callId,
      callerId: 'AudioSocket',
      callerName: 'AudioSocket Caller',
      startTime: new Date(),
      conversationHistory: [],
      currentSpeech: '',
      isActive: true
    };

    this.activeCalls.set(callId, callState);
    this.transcriptBuffers.set(callId, '');

    // Map AudioSocket to itself (since we're not using ARI channels)
    this.audioSocketToChannel.set(callId, callId);
    this.channelToAudioSocket.set(callId, callId);

    try {
      // Start speech-to-text for this call
      await this.sttService.startTranscription(callId);

      // Generate and speak greeting
      const greeting = await this.aiAgent.generateResponse([]);
      await this.speakToAudioSocket(callId, greeting);

      // Add greeting to conversation history
      callState.conversationHistory.push({
        role: 'assistant',
        content: greeting,
        timestamp: new Date()
      });

      // Start silence monitoring
      this.startSilenceTimer(callId);

    } catch (error) {
      this.logger.error(`Error handling AudioSocket connection ${callId}:`, error);
      this.audioSocketServer.closeConnection(callId);
    }
  }

  /**
   * Handle audio data from AudioSocket
   */
  private handleAudioSocketAudio(callId: string, audioData: Buffer): void {
    // Try to find the channel ID associated with this AudioSocket call ID
    let channelId = this.audioSocketToChannel.get(callId);

    // If not mapped yet, try to find the most recent active call
    // (AudioSocket connects slightly after the call is answered)
    if (!channelId) {
      // Find the most recently added call that doesn't have an AudioSocket mapping
      for (const [chId, callState] of this.activeCalls.entries()) {
        if (!this.channelToAudioSocket.has(chId)) {
          channelId = chId;
          this.audioSocketToChannel.set(callId, channelId);
          this.channelToAudioSocket.set(channelId, callId);
          this.logger.info(`Mapped AudioSocket ${callId} to channel ${channelId}`);
          break;
        }
      }
    }

    // If we have a mapping, forward audio to STT
    if (channelId && this.sttService.isActive(channelId)) {
      this.sttService.sendAudio(channelId, audioData);
    }
  }

  /**
   * Handle AudioSocket connection end
   */
  private handleAudioSocketEnd(callId: string): void {
    this.logger.info(`AudioSocket connection ended: ${callId}`);
    const channelId = this.audioSocketToChannel.get(callId);

    if (channelId) {
      this.audioSocketToChannel.delete(callId);
      this.channelToAudioSocket.delete(channelId);
    }
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down call manager...');

    // Clear all timers
    for (const timer of this.silenceTimers.values()) {
      clearTimeout(timer);
    }
    this.silenceTimers.clear();

    // Stop all transcriptions
    await this.sttService.stopAll();

    // Hangup all active calls
    for (const channelId of this.activeCalls.keys()) {
      try {
        await this.asteriskClient.hangup(channelId);
      } catch (error) {
        this.logger.error(`Error hanging up channel ${channelId}:`, error);
      }
    }

    this.activeCalls.clear();
    this.transcriptBuffers.clear();
    this.channelToAudioSocket.clear();
    this.audioSocketToChannel.clear();

    this.logger.info('Call manager shutdown complete');
  }
}
