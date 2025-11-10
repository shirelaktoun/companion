import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { SpeechClient } from '@google-cloud/speech';
import { EventEmitter } from 'events';
import { Logger } from 'winston';

export type STTProvider = 'deepgram' | 'google';

/**
 * Speech-to-Text service supporting multiple providers
 */
export class SpeechToTextService extends EventEmitter {
  private provider: STTProvider;
  private deepgramClient: any;
  private googleClient: SpeechClient | null = null;
  private logger: Logger;
  private apiKey: string;
  private googleCredentials?: string;
  private activeConnections: Map<string, any> = new Map();
  private googleStreams: Map<string, any> = new Map();

  constructor(
    provider: STTProvider,
    config: {
      deepgramApiKey?: string;
      googleCredentials?: string;
    },
    logger: Logger
  ) {
    super();
    this.provider = provider;
    this.apiKey = config.deepgramApiKey || '';
    this.googleCredentials = config.googleCredentials;
    this.logger = logger;

    // Initialize the selected provider
    if (provider === 'deepgram') {
      this.initializeDeepgram(config.deepgramApiKey);
    } else if (provider === 'google') {
      this.initializeGoogle(config.googleCredentials);
    }
  }

  private initializeDeepgram(apiKey?: string): void {
    if (apiKey) {
      this.deepgramClient = createClient(apiKey);
      this.logger.info('Deepgram STT service initialized');
    } else {
      this.logger.warn('No Deepgram API key provided, STT service disabled');
    }
  }

  private initializeGoogle(credentialsPath?: string): void {
    if (!credentialsPath) {
      this.logger.warn('No Google Cloud credentials provided');
      return;
    }

    try {
      this.googleClient = new SpeechClient({
        keyFilename: credentialsPath
      });
      this.logger.info('Google Cloud STT service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Google Cloud STT:', error);
    }
  }

  /**
   * Start transcribing audio for a channel
   */
  async startTranscription(channelId: string): Promise<void> {
    this.logger.info(`Starting transcription for channel ${channelId}`);

    if (this.provider === 'deepgram') {
      return this.startDeepgramTranscription(channelId);
    } else if (this.provider === 'google') {
      return this.startGoogleTranscription(channelId);
    }
  }

  /**
   * Start Deepgram transcription
   */
  private async startDeepgramTranscription(channelId: string): Promise<void> {
    if (!this.deepgramClient) {
      throw new Error('Deepgram client not initialized');
    }

    try {
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
   * Start Google Cloud STT streaming transcription
   */
  private async startGoogleTranscription(channelId: string): Promise<void> {
    if (!this.googleClient) {
      throw new Error('Google Cloud STT client not initialized');
    }

    try {
      const request = {
        config: {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: 8000,
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          model: 'phone_call',  // Optimized for phone audio
          useEnhanced: true,     // Use enhanced model for better accuracy
        },
        interimResults: true,
      };

      // Create a streaming recognition stream
      const recognizeStream = this.googleClient
        .streamingRecognize(request)
        .on('data', (data: any) => {
          if (data.results[0] && data.results[0].alternatives[0]) {
            const transcript = data.results[0].alternatives[0].transcript;
            const isFinal = data.results[0].isFinal;
            const confidence = data.results[0].alternatives[0].confidence || 0;

            if (transcript && transcript.trim().length > 0) {
              // Only log final transcripts to reduce log verbosity
              if (isFinal) {
                this.logger.info(`[STT] ${channelId}: "${transcript}"`);
              }

              // Emit transcript event
              this.emit('transcript', {
                channelId,
                transcript,
                isFinal,
                confidence
              });

              // Google doesn't have explicit utterance_end events,
              // so emit when we get a final result
              if (isFinal) {
                this.emit('utterance-end', { channelId });
              }
            }
          }
        })
        .on('error', (error: any) => {
          this.logger.error(`[STT] Google transcription error for channel ${channelId}:`, error);
          this.emit('error', { channelId, error });
        })
        .on('end', () => {
          this.logger.debug(`Google transcription stream ended for channel ${channelId}`);
          this.googleStreams.delete(channelId);
        });

      // Store the stream
      this.googleStreams.set(channelId, recognizeStream);
      this.activeConnections.set(channelId, recognizeStream);

      this.logger.info(`[STT] Google Cloud transcription started for channel ${channelId}`);

    } catch (error) {
      this.logger.error(`Error starting Google transcription for channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Send audio data to transcription service
   */
  sendAudio(channelId: string, audioData: Buffer): void {
    if (this.provider === 'deepgram') {
      const connection = this.activeConnections.get(channelId);
      if (!connection) {
        this.logger.warn(`No active Deepgram connection for channel ${channelId}`);
        return;
      }
      try {
        connection.send(audioData);
      } catch (error) {
        this.logger.error(`Error sending audio to Deepgram for channel ${channelId}:`, error);
      }
    } else if (this.provider === 'google') {
      const stream = this.googleStreams.get(channelId);
      if (!stream) {
        this.logger.warn(`No active Google stream for channel ${channelId}`);
        return;
      }
      try {
        stream.write(audioData);
      } catch (error) {
        this.logger.error(`Error sending audio to Google for channel ${channelId}:`, error);
      }
    }
  }

  /**
   * Stop transcription for a channel
   */
  async stopTranscription(channelId: string): Promise<void> {
    if (this.provider === 'deepgram') {
      const connection = this.activeConnections.get(channelId);
      if (!connection) {
        this.logger.warn(`No active Deepgram connection to stop for channel ${channelId}`);
        return;
      }
      try {
        this.logger.info(`Stopping Deepgram transcription for channel ${channelId}`);
        connection.finish();
        this.activeConnections.delete(channelId);
      } catch (error) {
        this.logger.error(`Error stopping Deepgram transcription for channel ${channelId}:`, error);
      }
    } else if (this.provider === 'google') {
      const stream = this.googleStreams.get(channelId);
      if (!stream) {
        this.logger.warn(`No active Google stream to stop for channel ${channelId}`);
        return;
      }
      try {
        this.logger.info(`Stopping Google transcription for channel ${channelId}`);
        stream.end();
        this.googleStreams.delete(channelId);
        this.activeConnections.delete(channelId);
      } catch (error) {
        this.logger.error(`Error stopping Google transcription for channel ${channelId}:`, error);
      }
    }
  }

  /**
   * Stop all active transcriptions
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping all active transcriptions');

    if (this.provider === 'deepgram') {
      for (const [channelId, connection] of this.activeConnections.entries()) {
        try {
          connection.finish();
        } catch (error) {
          this.logger.error(`Error stopping Deepgram transcription for channel ${channelId}:`, error);
        }
      }
    } else if (this.provider === 'google') {
      for (const [channelId, stream] of this.googleStreams.entries()) {
        try {
          stream.end();
        } catch (error) {
          this.logger.error(`Error stopping Google transcription for channel ${channelId}:`, error);
        }
      }
      this.googleStreams.clear();
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
