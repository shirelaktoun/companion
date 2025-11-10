import dotenv from 'dotenv';
import { AppConfig } from './types';

// Load environment variables
dotenv.config();

/**
 * Load and validate application configuration from environment variables
 */
export function loadConfig(): AppConfig {
  // Validate required variables
  const required = [
    'ASTERISK_HOST',
    'ASTERISK_PORT',
    'ASTERISK_USERNAME',
    'ASTERISK_PASSWORD',
    'ASTERISK_APP_NAME',
    'ANTHROPIC_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    asterisk: {
      host: process.env.ASTERISK_HOST!,
      port: parseInt(process.env.ASTERISK_PORT!, 10),
      username: process.env.ASTERISK_USERNAME!,
      password: process.env.ASTERISK_PASSWORD!,
      appName: process.env.ASTERISK_APP_NAME!
    },
    ai: {
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
      maxTokens: parseInt(process.env.MAX_TOKENS || '400', 10)  // Reduced from 1024 for lower latency
    },
    speech: {
      deepgramApiKey: process.env.DEEPGRAM_API_KEY,
      ttsProvider: (process.env.TTS_PROVIDER || 'openai') as 'google' | 'openai',
      googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      openaiApiKey: process.env.OPENAI_API_KEY,
      voiceName: process.env.TTS_VOICE_NAME || 'nova',
      languageCode: process.env.TTS_LANGUAGE_CODE || 'en-US'
    },
    agent: {
      name: process.env.AGENT_NAME || 'Companion',
      personality: process.env.AGENT_PERSONALITY || 'friendly and caring',
      callTimeoutSeconds: parseInt(process.env.CALL_TIMEOUT_SECONDS || '300', 10),
      maxSilenceDuration: parseInt(process.env.MAX_SILENCE_DURATION || '10', 10)
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE || '/var/log/ai-companion/companion.log',
    httpPort: parseInt(process.env.HTTP_PORT || '3000', 10),
    webhookUrl: process.env.WEBHOOK_URL || ''  // Make.com webhook for call analysis
  };
}
