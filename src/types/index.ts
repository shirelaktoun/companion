/**
 * Type definitions for AI Companion PBX Agent
 */

export interface AsteriskConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  appName: string;
}

export interface AIConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface SpeechConfig {
  sttProvider: 'deepgram' | 'google';
  deepgramApiKey?: string;
  googleSttCredentials?: string;
  ttsProvider: 'google' | 'openai';
  googleTtsCredentials?: string;
  openaiApiKey?: string;
  voiceName?: string;
  languageCode?: string;
}

export interface AgentConfig {
  name: string;
  personality: string;
  callTimeoutSeconds: number;
  maxSilenceDuration: number;
}

export interface AppConfig {
  asterisk: AsteriskConfig;
  ai: AIConfig;
  speech: SpeechConfig;
  agent: AgentConfig;
  logLevel: string;
  logFile: string;
  httpPort: number;
  webhookUrl: string;
}

export interface CallState {
  channelId: string;
  callerId: string;
  callerName: string;
  startTime: Date;
  conversationHistory: ConversationMessage[];
  currentSpeech: string;
  isActive: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CallEvent {
  type: 'incoming' | 'answered' | 'speech' | 'silence' | 'hangup';
  channelId: string;
  data?: any;
}

export interface AudioChunk {
  channelId: string;
  audio: Buffer;
  timestamp: number;
}
