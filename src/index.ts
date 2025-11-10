#!/usr/bin/env node

import { loadConfig } from './config';
import { createLogger } from './logger';
import { AsteriskClient } from './services/asterisk-client';
import { SpeechToTextService } from './services/speech-to-text';
import { TextToSpeechService } from './services/text-to-speech';
import { AIAgent } from './services/ai-agent';
import { CallManager } from './services/call-manager';
import { AudioSocketServer } from './services/audiosocket-server';

/**
 * AI Companion PBX Agent
 * Main application entry point
 */

let callManager: CallManager;
let asteriskClient: AsteriskClient;
let logger: any;

async function main() {
  try {
    // Load configuration
    const config = loadConfig();

    // Initialize logger
    logger = createLogger(config.logLevel, config.logFile);
    logger.info('AI Companion starting...');
    logger.info(`Asterisk: ${config.asterisk.host}:${config.asterisk.port} | Agent: ${config.agent.name} | Webhook: ${config.webhookUrl ? 'Yes' : 'No'}`);

    // Initialize Asterisk client
    asteriskClient = new AsteriskClient(config.asterisk, logger);

    // Initialize Speech-to-Text
    const sttService = new SpeechToTextService(
      config.speech.sttProvider,
      {
        deepgramApiKey: config.speech.deepgramApiKey,
        googleCredentials: config.speech.googleSttCredentials
      },
      logger
    );

    // Initialize Text-to-Speech
    const ttsService = new TextToSpeechService(
      config.speech.ttsProvider,
      {
        googleCredentials: config.speech.googleTtsCredentials,
        openaiApiKey: config.speech.openaiApiKey,
        voiceName: config.speech.voiceName,
        languageCode: config.speech.languageCode
      },
      logger
    );

    // Initialize AI Agent
    const aiAgent = new AIAgent(
      config.ai.apiKey,
      config.agent,
      config.ai.model || 'claude-3-5-sonnet-20241022',
      config.ai.maxTokens || 1024,
      logger
    );

    // Initialize AudioSocket Server for real-time audio capture
    const audioSocketServer = new AudioSocketServer(5039, logger);
    await audioSocketServer.start();

    // Initialize Call Manager
    callManager = new CallManager(
      asteriskClient,
      sttService,
      ttsService,
      aiAgent,
      config.agent,
      logger,
      audioSocketServer,
      config.webhookUrl
    );

    // Connect to Asterisk
    await asteriskClient.connect();

    logger.info('AI Companion ready for calls');

    // Set up periodic cleanup of old audio files
    setInterval(async () => {
      await ttsService.cleanupOldFiles(60);
    }, 300000); // Every 5 minutes

  } catch (error) {
    if (logger) {
      logger.error('Fatal error starting application:', error);
    } else {
      console.error('Fatal error starting application:', error);
    }
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string) {
  logger.info(`\n${signal} received, shutting down gracefully...`);

  try {
    // Shutdown call manager
    if (callManager) {
      await callManager.shutdown();
    }

    // Disconnect from Asterisk
    if (asteriskClient) {
      await asteriskClient.disconnect();
    }

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Set up signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  if (logger) {
    logger.error('Uncaught exception:', error);
  } else {
    console.error('Uncaught exception:', error);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  if (logger) {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  } else {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
  }
  process.exit(1);
});

// Start the application
main();
