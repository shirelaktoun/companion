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
    logger.info('='.repeat(60));
    logger.info('AI Companion PBX Agent Starting...');
    logger.info('='.repeat(60));

    // Log configuration (without sensitive data)
    logger.info('Configuration:');
    logger.info(`  Asterisk: ${config.asterisk.host}:${config.asterisk.port}`);
    logger.info(`  Application: ${config.asterisk.appName}`);
    logger.info(`  Agent Name: ${config.agent.name}`);
    logger.info(`  AI Model: ${config.ai.model}`);
    logger.info(`  Log Level: ${config.logLevel}`);

    // Initialize services
    logger.info('Initializing services...');

    // Initialize Asterisk client
    asteriskClient = new AsteriskClient(config.asterisk, logger);

    // Initialize Speech-to-Text
    const sttService = new SpeechToTextService(
      config.speech.deepgramApiKey || '',
      logger
    );

    // Initialize Text-to-Speech
    const ttsService = new TextToSpeechService(
      config.speech.ttsProvider,
      {
        googleCredentials: config.speech.googleCredentials,
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
    logger.info('Starting AudioSocket server...');
    const audioSocketServer = new AudioSocketServer(5038, logger);
    await audioSocketServer.start();

    // Initialize Call Manager
    // Note: Audio files are now saved directly to Asterisk's sounds directory
    // and played using the sound: prefix, so no HTTP server is needed
    callManager = new CallManager(
      asteriskClient,
      sttService,
      ttsService,
      aiAgent,
      config.agent,
      logger,
      audioSocketServer
    );

    // Set up call manager events
    callManager.on('call-ended', (data) => {
      logger.info(`Call ended: ${data.channelId} (duration: ${data.duration}s, messages: ${data.messageCount})`);
    });

    // Connect to Asterisk
    logger.info('Connecting to Asterisk...');
    await asteriskClient.connect();

    logger.info('='.repeat(60));
    logger.info('AI Companion Agent is ready and waiting for calls!');
    logger.info('='.repeat(60));

    // Set up periodic cleanup of old audio files
    setInterval(async () => {
      await ttsService.cleanupOldFiles(60);
    }, 300000); // Every 5 minutes

    // Log status periodically
    setInterval(() => {
      const activeCall = callManager.getActiveCallCount();
      if (activeCall > 0) {
        logger.info(`Status: ${activeCall} active call(s)`);
      }
    }, 60000); // Every minute

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
