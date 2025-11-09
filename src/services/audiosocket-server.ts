import net from 'net';
import { EventEmitter } from 'events';
import { Logger } from 'winston';

/**
 * AudioSocket Server for receiving audio streams from Asterisk
 *
 * AudioSocket Protocol:
 * - Asterisk connects via TCP
 * - Sends UUID (16 bytes) identifying the call
 * - Sends audio frames (3-byte header + audio data)
 * - Header: 0x00 (kind), 2-byte length (big-endian)
 * - Audio: Raw audio bytes (typically mulaw/ulaw)
 */
export class AudioSocketServer extends EventEmitter {
  private server: net.Server | null = null;
  private logger: Logger;
  private port: number;
  private connections: Map<string, net.Socket> = new Map();
  private silenceIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(port: number, logger: Logger) {
    super();
    this.port = port;
    this.logger = logger;
  }

  /**
   * Start the AudioSocket server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.logger.info(`AudioSocket server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        this.logger.error('AudioSocket server error:', error);
      });
    });
  }

  /**
   * Handle incoming AudioSocket connection
   */
  private handleConnection(socket: net.Socket): void {
    this.logger.debug(`New AudioSocket connection from ${socket.remoteAddress}`);

    let callId: string | null = null;
    let buffer = Buffer.alloc(0);
    let uuidReceived = false;

    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // First, read the protocol header (3 bytes) + UUID (16 bytes) = 19 bytes total
      // Asterisk AudioSocket sends: [3-byte header][16-byte UUID][audio frames...]
      if (!uuidReceived && buffer.length >= 19) {
        // Skip first 3 bytes (protocol header: version/flags/length)
        const header = buffer.slice(0, 3);
        this.logger.debug(`AudioSocket protocol header (hex): ${header.toString('hex')}`);

        // Read the next 16 bytes as UUID
        const uuidBytes = buffer.slice(3, 19);
        buffer = buffer.slice(19);

        // Log raw UUID bytes for debugging
        this.logger.debug(`AudioSocket UUID raw bytes (hex): ${uuidBytes.toString('hex')}`);

        // Convert 16 bytes to UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const hex = uuidBytes.toString('hex');
        callId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

        uuidReceived = true;

        this.logger.info(`AudioSocket connection from snoop channel: ${callId}`);
        this.connections.set(callId, socket);

        // Emit connection event
        this.emit('connection', { callId });

        // DON'T send silence frames - snoop is receive-only (Asterisk -> us)
        // Sending audio back causes ECONNRESET
      }

      // Process audio frames
      while (uuidReceived && buffer.length >= 3) {
        // Read frame header
        const kind = buffer.readUInt8(0);
        const length = buffer.readUInt16BE(1);

        // Check if we have the full frame
        if (buffer.length < 3 + length) {
          break; // Wait for more data
        }

        // Extract audio data
        const audioData = buffer.slice(3, 3 + length);
        buffer = buffer.slice(3 + length);

        // Kind 0x00 = audio frame, 0x01 = hangup
        if (kind === 0x00 && callId) {
          // Emit audio data event
          this.emit('audio', {
            callId,
            audioData
          });
        } else if (kind === 0x01) {
          this.logger.debug(`AudioSocket hangup received for ${callId}`);
          this.emit('hangup', { callId });
        }
      }
    });

    socket.on('end', () => {
      if (callId) {
        this.logger.info(`AudioSocket connection ended: ${callId}`);
        this.stopSilenceFrames(callId);
        this.connections.delete(callId);
        this.emit('end', { callId });
      }
    });

    socket.on('error', (error) => {
      this.logger.error(`AudioSocket connection error for ${callId}:`, error);
      if (callId) {
        this.stopSilenceFrames(callId);
        this.connections.delete(callId);
      }
    });
  }

  /**
   * Send audio data to a specific call
   */
  sendAudio(callId: string, audioData: Buffer): void {
    const socket = this.connections.get(callId);

    if (!socket) {
      this.logger.warn(`No AudioSocket connection for call ${callId}`);
      return;
    }

    try {
      // Create AudioSocket frame: kind (0x00) + length (2 bytes BE) + data
      const header = Buffer.alloc(3);
      header.writeUInt8(0x00, 0); // Kind: audio
      header.writeUInt16BE(audioData.length, 1); // Length

      const frame = Buffer.concat([header, audioData]);
      socket.write(frame);
    } catch (error) {
      this.logger.error(`Error sending audio to call ${callId}:`, error);
    }
  }

  /**
   * Start sending silence frames to keep the AudioSocket connection alive
   * Asterisk expects bidirectional audio
   */
  private startSilenceFrames(callId: string, socket: net.Socket): void {
    // Send silence frames every 20ms (50 frames per second)
    // Silence in mulaw is 0xFF
    const silenceData = Buffer.alloc(160, 0xFF); // 160 bytes = 20ms of 8kHz mulaw audio

    const interval = setInterval(() => {
      try {
        const header = Buffer.alloc(3);
        header.writeUInt8(0x00, 0); // Kind: audio
        header.writeUInt16BE(silenceData.length, 1); // Length

        const frame = Buffer.concat([header, silenceData]);
        socket.write(frame);
      } catch (error) {
        this.logger.error(`Error sending silence frame to ${callId}:`, error);
        clearInterval(interval);
        this.silenceIntervals.delete(callId);
      }
    }, 20); // Every 20ms

    this.silenceIntervals.set(callId, interval);
    this.logger.debug(`Started sending silence frames to ${callId}`);
  }

  /**
   * Stop sending silence frames
   */
  private stopSilenceFrames(callId: string): void {
    const interval = this.silenceIntervals.get(callId);
    if (interval) {
      clearInterval(interval);
      this.silenceIntervals.delete(callId);
      this.logger.debug(`Stopped sending silence frames to ${callId}`);
    }
  }

  /**
   * Close a specific AudioSocket connection
   */
  closeConnection(callId: string): void {
    this.stopSilenceFrames(callId);
    const socket = this.connections.get(callId);

    if (socket) {
      socket.end();
      this.connections.delete(callId);
      this.logger.debug(`Closed AudioSocket connection for ${callId}`);
    }
  }

  /**
   * Stop the AudioSocket server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Close all connections
        for (const [callId, socket] of this.connections.entries()) {
          socket.end();
        }
        this.connections.clear();

        this.server.close(() => {
          this.logger.info('AudioSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get active connections count
   */
  getActiveConnections(): number {
    return this.connections.size;
  }
}
