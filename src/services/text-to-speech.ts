import * as textToSpeech from '@google-cloud/text-to-speech';
import OpenAI from 'openai';
import { Logger } from 'winston';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';

export type TTSProvider = 'google' | 'openai';

/**
 * Text-to-Speech service supporting multiple providers
 */
export class TextToSpeechService {
  private googleClient: textToSpeech.TextToSpeechClient | null = null;
  private openaiClient: OpenAI | null = null;
  private provider: TTSProvider;
  private logger: Logger;
  private voiceName: string;
  private languageCode: string;
  private audioDir: string;

  constructor(
    provider: TTSProvider,
    config: {
      googleCredentials?: string;
      openaiApiKey?: string;
      voiceName?: string;
      languageCode?: string;
    },
    logger: Logger
  ) {
    this.logger = logger;
    this.provider = provider;
    this.voiceName = config.voiceName || 'en-US-Neural2-J';
    this.languageCode = config.languageCode || 'en-US';

    // Use writable audio cache directory
    // This will be symlinked to Asterisk sounds directory
    this.audioDir = '/opt/ai-companion/audio-cache';

    // Ensure audio directory exists
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }

    // Initialize the selected provider
    if (provider === 'google') {
      this.initializeGoogleTTS(config.googleCredentials);
    } else if (provider === 'openai') {
      this.initializeOpenAITTS(config.openaiApiKey);
    }
  }

  /**
   * Initialize Google Cloud TTS
   */
  private initializeGoogleTTS(credentialsPath?: string): void {
    if (!credentialsPath) {
      this.logger.warn('No Google Cloud credentials provided');
      return;
    }

    try {
      this.googleClient = new textToSpeech.TextToSpeechClient({
        keyFilename: credentialsPath
      });
      this.logger.info('Google Cloud TTS service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Google Cloud TTS:', error);
    }
  }

  /**
   * Initialize OpenAI TTS
   */
  private initializeOpenAITTS(apiKey?: string): void {
    if (!apiKey) {
      this.logger.warn('No OpenAI API key provided');
      return;
    }

    try {
      this.openaiClient = new OpenAI({ apiKey });
      this.logger.info('OpenAI TTS service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI TTS:', error);
    }
  }

  /**
   * Convert text to speech and save as audio file
   */
  async synthesize(text: string, channelId?: string): Promise<string> {
    this.logger.debug(`Synthesizing text with ${this.provider}: ${text.substring(0, 50)}...`);

    if (this.provider === 'google') {
      return this.synthesizeWithGoogle(text, channelId);
    } else if (this.provider === 'openai') {
      return this.synthesizeWithOpenAI(text, channelId);
    }

    throw new Error(`Unsupported TTS provider: ${this.provider}`);
  }

  /**
   * Synthesize with Google Cloud TTS
   */
  private async synthesizeWithGoogle(text: string, channelId?: string): Promise<string> {
    if (!this.googleClient) {
      throw new Error('Google TTS client not initialized');
    }

    try {
      const request = {
        input: { text },
        voice: {
          languageCode: this.languageCode,
          name: this.voiceName,
          ssmlGender: 'NEUTRAL' as const
        },
        audioConfig: {
          audioEncoding: 'LINEAR16' as const,
          sampleRateHertz: 8000, // Phone quality
          speakingRate: 1.0,
          pitch: 0.0
        }
      };

      const [response] = await this.googleClient.synthesizeSpeech(request);

      if (!response.audioContent) {
        throw new Error('No audio content received from Google TTS');
      }

      const filename = `tts_google_${channelId || 'unknown'}_${uuidv4()}.wav`;
      const filePath = path.join(this.audioDir, filename);

      await util.promisify(fs.writeFile)(filePath, response.audioContent, 'binary');

      this.logger.debug(`Google TTS audio saved to ${filePath}`);

      // Return just the filename without extension for sound: prefix
      return path.basename(filename, '.wav');

    } catch (error) {
      this.logger.error('Error with Google TTS:', error);
      throw error;
    }
  }

  /**
   * Synthesize with OpenAI TTS
   */
  private async synthesizeWithOpenAI(text: string, channelId?: string): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI TTS client not initialized');
    }

    try {
      // OpenAI TTS voices: alloy, echo, fable, onyx, nova, shimmer
      // Map voice name or use configured voice directly
      const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
      let openaiVoice = this.voiceName.toLowerCase();

      // If voice name isn't a valid OpenAI voice, try to map it
      if (!validVoices.includes(openaiVoice)) {
        if (openaiVoice.includes('female')) {
          openaiVoice = 'nova';
        } else if (openaiVoice.includes('male')) {
          openaiVoice = 'onyx';
        } else {
          openaiVoice = 'nova'; // Default
        }
      }

      const audioResponse = await this.openaiClient.audio.speech.create({
        model: 'tts-1-hd', // High quality model
        voice: openaiVoice as any,
        input: text,
        response_format: 'wav' // WAV format for better Asterisk compatibility
      });

      const buffer = Buffer.from(await audioResponse.arrayBuffer());

      const filename = `tts_openai_${channelId || 'unknown'}_${uuidv4()}.wav`;
      const tempPath = path.join(this.audioDir, `temp_${filename}`);
      const filePath = path.join(this.audioDir, filename);

      // Save the original audio
      await util.promisify(fs.writeFile)(tempPath, buffer);

      // Convert to 8kHz mono WAV for Asterisk compatibility
      // OpenAI generates 24kHz audio, but Asterisk needs 8kHz for telephony
      await this.convertTo8kHz(tempPath, filePath);

      // Remove temporary file
      await util.promisify(fs.unlink)(tempPath);

      this.logger.debug(`OpenAI TTS audio saved and converted to ${filePath}`);

      // Return just the filename without extension for sound: prefix
      return path.basename(filename, '.wav');

    } catch (error) {
      this.logger.error('Error with OpenAI TTS:', error);
      throw error;
    }
  }

  /**
   * Convert audio file to 8kHz mono mulaw for Asterisk telephony
   * Creates both WAV (for sound: protocol) and raw mulaw (for AudioSocket)
   */
  private async convertTo8kHz(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Convert to 8kHz mono mulaw WAV (for Asterisk sound: and AudioSocket)
      // mulaw is the standard telephony codec
      const command = `ffmpeg -i "${inputPath}" -ar 8000 -ac 1 -acodec pcm_mulaw -y "${outputPath}" 2>&1`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Audio conversion failed: ${error.message}`);
          this.logger.error(`FFmpeg output: ${stderr}`);
          reject(new Error(`Audio conversion failed: ${error.message}`));
        } else {
          this.logger.debug(`Audio converted to 8kHz mulaw: ${outputPath}`);
          resolve();
        }
      });
    });
  }

  /**
   * Clean up old audio files
   */
  async cleanupOldFiles(maxAgeMinutes: number = 60): Promise<void> {
    try {
      const files = await util.promisify(fs.readdir)(this.audioDir);
      const now = Date.now();
      const maxAge = maxAgeMinutes * 60 * 1000;

      let deletedCount = 0;

      for (const file of files) {
        // Skip directories and non-audio files
        if (!file.endsWith('.wav') && !file.endsWith('.mp3')) {
          continue;
        }

        const filePath = path.join(this.audioDir, file);
        const stats = await util.promisify(fs.stat)(filePath);

        if (now - stats.mtimeMs > maxAge) {
          await util.promisify(fs.unlink)(filePath);
          deletedCount++;
          this.logger.debug(`Deleted audio file: ${filePath}`);
        }
      }

      if (deletedCount > 0) {
        this.logger.info(`Cleaned up ${deletedCount} old TTS audio files`);
      }
    } catch (error) {
      this.logger.error('Error cleaning up old audio files:', error);
    }
  }

  /**
   * Delete a specific audio file
   */
  async deleteFile(filename: string): Promise<void> {
    try {
      // If filename doesn't include path, assume it's in audioDir
      const filePath = filename.includes(path.sep)
        ? filename
        : path.join(this.audioDir, filename + '.wav');

      if (fs.existsSync(filePath)) {
        await util.promisify(fs.unlink)(filePath);
        this.logger.debug(`Deleted audio file: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting audio file ${filename}:`, error);
    }
  }

  /**
   * Convert audio file to Asterisk-compatible format
   * Returns the path to the converted file
   */
  async convertToAsteriskFormat(inputPath: string): Promise<string> {
    // For now, we're already generating in LINEAR16 at 8000Hz which is compatible
    // If needed, we can add sox or ffmpeg conversion here
    return inputPath;
  }

  /**
   * Get audio directory
   */
  getAudioDirectory(): string {
    return this.audioDir;
  }
}
