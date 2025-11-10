import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'events';
import { Logger } from 'winston';

/**
 * Speech-to-Text service using Deepgram
 */
export class SpeechToTextService extends EventEmitter {
  private deepgramClient: any;
  private logger: Logger;
  private apiKey: string;
  private activeConnections: Map<string, any> = new Map();

  constructor(apiKey: string, logger: Logger) {
    super();
    this.apiKey = apiKey;
    this.logger = logger;

    if (apiKey) {
      this.deepgramClient = createClient(apiKey);
      this.logger.info('Deepgram STT service initialized');
    } else {
      this.logger.warn('No Deepgram API key provided, STT service disabled');
    }
  }

  /**
   * Start transcribing audio for a channel
   */
  async startTranscription(channelId: string): Promise<void> {
    if (!this.deepgramClient) {
      throw new Error('Deepgram client not initialized');
    }

    try {
      this.logger.info(`Starting transcription for channel ${channelId}`);

      // Create live transcription connection
      // AudioSocket sends SLIN format (16-bit signed linear PCM)
      const connection = this.deepgramClient.listen.live({
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1000,  // Deepgram requires 1000ms minimum (750 causes 400 errors)
        vad_events: true,
        encoding: 'linear16',  // SLIN = 16-bit signed linear PCM
        sample_rate: 8000,
        channels: 1
      });

      // Handle transcription events
      connection.on(LiveTranscriptionEvents.Open, () => {
        this.logger.info(`[STT] Transcription connection opened for channel ${channelId}`);
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const transcript = data.channel.alternatives[0].transcript;

        if (transcript && transcript.trim().length > 0) {
          const isFinal = data.is_final;

          // Only log final transcripts to reduce log verbosity
          if (isFinal) {
            this.logger.info(`[STT] ${channelId}: "${transcript}"`);
          }

          // Emit transcript event
          this.emit('transcript', {
            channelId,
            transcript,
            isFinal,
            confidence: data.channel.alternatives[0].confidence
          });
        }
      });

      connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        // Don't log utterance end - too verbose
        this.emit('utterance-end', { channelId });
      });

      connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
        // Don't log speech start - too verbose
        this.emit('speech-started', { channelId });
      });

      connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        this.logger.error(`[STT] Transcription error for channel ${channelId}:`, error);
        this.emit('error', { channelId, error });
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        this.logger.debug(`Transcription connection closed for channel ${channelId}`);
        this.activeConnections.delete(channelId);
      });

      // Store connection
      this.activeConnections.set(channelId, connection);

    } catch (error) {
      this.logger.error(`Error starting transcription for channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Send audio data to transcription service
   */
  sendAudio(channelId: string, audioData: Buffer): void {
    const connection = this.activeConnections.get(channelId);

    if (!connection) {
      this.logger.warn(`No active transcription connection for channel ${channelId}`);
      return;
    }

    try {
      connection.send(audioData);
    } catch (error) {
      this.logger.error(`Error sending audio for channel ${channelId}:`, error);
    }
  }

  /**
   * Stop transcription for a channel
   */
  async stopTranscription(channelId: string): Promise<void> {
    const connection = this.activeConnections.get(channelId);

    if (!connection) {
      this.logger.warn(`No active transcription connection to stop for channel ${channelId}`);
      return;
    }

    try {
      this.logger.info(`Stopping transcription for channel ${channelId}`);
      connection.finish();
      this.activeConnections.delete(channelId);
    } catch (error) {
      this.logger.error(`Error stopping transcription for channel ${channelId}:`, error);
    }
  }

  /**
   * Stop all active transcriptions
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping all active transcriptions');

    for (const [channelId, connection] of this.activeConnections.entries()) {
      try {
        connection.finish();
      } catch (error) {
        this.logger.error(`Error stopping transcription for channel ${channelId}:`, error);
      }
    }

    this.activeConnections.clear();
  }

  /**
   * Check if transcription is active for a channel
   */
  isActive(channelId: string): boolean {
    return this.activeConnections.has(channelId);
  }
}
