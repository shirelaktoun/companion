import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { CallState, ConversationMessage, AgentConfig } from '../types';
import { AsteriskClient } from './asterisk-client';
import { SpeechToTextService } from './speech-to-text';
import { TextToSpeechService } from './text-to-speech';
import { AIAgent } from './ai-agent';
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

  private activeCalls: Map<string, CallState> = new Map();
  private silenceTimers: Map<string, NodeJS.Timeout> = new Map();
  private transcriptBuffers: Map<string, string> = new Map();

  constructor(
    asteriskClient: AsteriskClient,
    sttService: SpeechToTextService,
    ttsService: TextToSpeechService,
    aiAgent: AIAgent,
    config: AgentConfig,
    logger: Logger
  ) {
    super();
    this.asteriskClient = asteriskClient;
    this.sttService = sttService;
    this.ttsService = ttsService;
    this.aiAgent = aiAgent;
    this.config = config;
    this.logger = logger;

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

      // Speak the response
      await this.speakToChannel(channelId, response);

    } catch (error) {
      this.logger.error(`Error generating response for ${channelId}:`, error);
      await this.speakToChannel(channelId, "I'm sorry, I'm having trouble responding. Could you say that again?");
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
      await this.speakToChannel(channelId, prompt);

      // Restart silence timer
      this.startSilenceTimer(channelId);

    } catch (error) {
      this.logger.error(`Error handling silence for ${channelId}:`, error);
    }
  }

  /**
   * Speak text to a channel
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

    this.logger.info('Call manager shutdown complete');
  }
}
