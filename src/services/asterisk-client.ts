import ari, { Client, Channel, StasisStart } from 'ari-client';
import { EventEmitter } from 'events';
import { AsteriskConfig } from '../types';
import { Logger } from 'winston';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * Asterisk ARI Client for managing telephony connections
 */
export class AsteriskClient extends EventEmitter {
  private client: Client | null = null;
  private config: AsteriskConfig;
  private logger: Logger;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

  constructor(config: AsteriskConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  /**
   * Connect to Asterisk ARI
   */
  async connect(): Promise<void> {
    try {
      this.logger.info(`Connecting to Asterisk at ${this.config.host}:${this.config.port}...`);

      this.client = await ari.connect(
        `http://${this.config.host}:${this.config.port}`,
        this.config.username,
        this.config.password
      );

      this.isConnected = true;
      this.logger.info('Connected to Asterisk ARI');

      // Set up event handlers
      this.setupEventHandlers();

      // Start Stasis application
      this.client.start(this.config.appName);
      this.logger.info(`Stasis application '${this.config.appName}' started`);

      this.emit('connected');
    } catch (error) {
      this.logger.error('Failed to connect to Asterisk:', error);
      this.isConnected = false;
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Set up event handlers for Asterisk events
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // Handle incoming calls
    this.client.on('StasisStart', (event: StasisStart, channel: Channel) => {
      // Ignore snoop channels - they shouldn't be handled as incoming calls
      const channelName = channel.name || '';
      const channelId = channel.id || '';

      // Snoop channels have names like "Snoop/PJSIP-xxxx..." - filter them out
      if (channelName.startsWith('Snoop/') || channelId.startsWith('audiosocket-')) {
        this.logger.debug(`Ignoring snoop/internal channel ${channelName} (${channelId}) entering Stasis`);
        return;
      }

      this.logger.info(`Incoming call on channel ${channel.id} from ${channel.caller.number}`);
      this.handleIncomingCall(channel);
    });

    // Handle channel state changes
    this.client.on('ChannelStateChange', (event: any, channel: Channel) => {
      this.logger.debug(`Channel ${channel.id} state changed to ${event.channel.state}`);
    });

    // Handle channel hangup
    this.client.on('ChannelHangupRequest', (event: any, channel: Channel) => {
      this.logger.info(`Hangup requested for channel ${channel.id}`);
      this.emit('hangup', { channelId: channel.id });
    });

    // Handle channel destruction
    this.client.on('ChannelDestroyed', (event: any, channel: Channel) => {
      this.logger.info(`Channel ${channel.id} destroyed`);
      this.emit('channel-destroyed', { channelId: channel.id });
    });

    // Handle errors
    this.client.on('error', (error: Error) => {
      this.logger.error('Asterisk client error:', error);
      this.isConnected = false;
      this.scheduleReconnect();
    });
  }

  /**
   * Handle incoming call
   */
  private async handleIncomingCall(channel: Channel): Promise<void> {
    try {
      // Answer the call
      await channel.answer();
      this.logger.info(`Answered channel ${channel.id}`);

      // Emit call answered event
      this.emit('call-answered', {
        channelId: channel.id,
        callerId: channel.caller.number,
        callerName: channel.caller.name || 'Unknown'
      });

      // Play a greeting (optional - can be removed if AI speaks first)
      // await this.playAudio(channel.id, 'sound:hello');

    } catch (error) {
      this.logger.error(`Error handling incoming call on channel ${channel.id}:`, error);
      try {
        await channel.hangup();
      } catch (hangupError) {
        this.logger.error('Error hanging up channel:', hangupError);
      }
    }
  }

  /**
   * Initiate an outgoing call
   */
  async makeCall(destination: string, callerId?: string): Promise<string> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      this.logger.info(`Making outgoing call to ${destination}`);

      const channel = this.client.Channel();

      const channelData: any = {
        endpoint: `PJSIP/${destination}`,
        app: this.config.appName
      };

      if (callerId) {
        channelData.callerId = callerId;
      }

      await channel.originate(channelData);

      this.logger.info(`Outgoing call initiated to ${destination}, channel: ${channel.id}`);
      return channel.id;
    } catch (error) {
      this.logger.error(`Error making call to ${destination}:`, error);
      throw error;
    }
  }

  /**
   * Play audio to a channel
   */
  async playAudio(channelId: string, audioUri: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      const channel = this.client.Channel(channelId);
      const playback = this.client.Playback();

      await channel.play({ media: audioUri }, playback);
      this.logger.debug(`Playing audio to channel ${channelId}: ${audioUri}`);
    } catch (error) {
      this.logger.error(`Error playing audio to channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Start recording audio from a channel
   */
  async startRecording(channelId: string, recordingName: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      const channel = this.client.Channel(channelId);

      await channel.record({
        name: recordingName,
        format: 'wav',
        maxDurationSeconds: 3600,
        ifExists: 'overwrite'
      });

      this.logger.debug(`Started recording on channel ${channelId}`);
    } catch (error) {
      this.logger.error(`Error starting recording on channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Stop recording on a channel
   */
  async stopRecording(channelId: string, recordingName: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      const recording = this.client.LiveRecording(recordingName);
      await recording.stop();
      this.logger.debug(`Stopped recording on channel ${channelId}`);
    } catch (error) {
      this.logger.error(`Error stopping recording on channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Start snooping on a channel to capture audio
   * Returns the snoop channel ID and AudioSocket UUID
   */
  async startSnoop(channelId: string): Promise<{ snoopChannelId: string; audioSocketUuid: string }> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      // Create snoop channel using raw HTTP API
      // ari-client doesn't expose the snoop method, so we use axios directly
      const ariUrl = `http://${this.config.host}:${this.config.port}/ari`;
      const auth = {
        username: this.config.username,
        password: this.config.password
      };

      this.logger.debug(`Creating snoop channel on ${channelId}...`);

      // Generate proper UUID for AudioSocket connection
      // AudioSocket() application requires valid UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
      const audioSocketUuid = uuidv4();

      // POST /ari/channels/{channelId}/snoop
      const snoopResponse = await axios.post(
        `${ariUrl}/channels/${channelId}/snoop`,
        {},
        {
          params: {
            spy: 'out',  // Capture audio from caller (out = from endpoint to Asterisk)
            whisper: 'none',  // Don't whisper anything back
            app: this.config.appName,  // Snoop enters Stasis (will be filtered in StasisStart handler)
            appArgs: audioSocketUuid  // Pass UUID as app arg
          },
          auth
        }
      );

      const snoopChannelId = snoopResponse.data.id;
      this.logger.info(`Started snoop on channel ${channelId}, snoop channel: ${snoopChannelId}`);

      // Send snoop channel to dialplan to execute AudioSocket
      this.logger.debug(`Sending snoop channel ${snoopChannelId} to AudioSocket dialplan...`);

      // POST /ari/channels/{channelId}/continue
      await axios.post(
        `${ariUrl}/channels/${snoopChannelId}/continue`,
        {},
        {
          params: {
            context: 'ai-companion-audiosocket',
            extension: audioSocketUuid,  // Use UUID as extension
            priority: 1
          },
          auth
        }
      );

      this.logger.info(`Snoop channel sent to AudioSocket dialplan with UUID: ${audioSocketUuid}`);

      return { snoopChannelId, audioSocketUuid };
    } catch (error) {
      this.logger.error(`Error starting snoop on channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Stop snooping on a channel
   */
  async stopSnoop(snoopChannelId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      const channel = this.client.Channel(snoopChannelId);
      await channel.hangup();
      this.logger.info(`Stopped snoop channel ${snoopChannelId}`);
    } catch (error) {
      this.logger.error(`Error stopping snoop channel ${snoopChannelId}:`, error);
    }
  }

  /**
   * Hangup a channel
   */
  async hangup(channelId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      const channel = this.client.Channel(channelId);
      await channel.hangup();
      this.logger.info(`Hung up channel ${channelId}`);
    } catch (error) {
      this.logger.error(`Error hanging up channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Get audio stream from channel (for real-time STT)
   */
  async getExternalMedia(channelId: string): Promise<any> {
    if (!this.client) {
      throw new Error('Not connected to Asterisk');
    }

    try {
      const channel = this.client.Channel(channelId);

      // Create external media channel for audio streaming
      const externalMedia = await channel.externalMedia({
        app: this.config.appName,
        external_host: '127.0.0.1:5060',
        format: 'ulaw'
      });

      return externalMedia;
    } catch (error) {
      this.logger.error(`Error getting external media for channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    const reconnectDelay = 5000; // 5 seconds
    this.logger.info(`Scheduling reconnection in ${reconnectDelay}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        // Will be scheduled again by connect()
      }
    }, reconnectDelay);
  }

  /**
   * Disconnect from Asterisk
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnected = false;

    if (this.client) {
      this.logger.info('Disconnecting from Asterisk...');
      // ARI client doesn't have explicit disconnect, just stop listening
      this.client.removeAllListeners();
      this.client = null;
    }
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.isConnected;
  }
}
