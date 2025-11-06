import express from 'express';
import path from 'path';
import { Logger } from 'winston';

/**
 * HTTP server to serve audio files to Asterisk
 */
export class AudioServer {
  private app: express.Application;
  private server: any;
  private logger: Logger;
  private audioDir: string;
  private port: number;

  constructor(audioDir: string, port: number, logger: Logger) {
    this.audioDir = audioDir;
    this.port = port;
    this.logger = logger;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Serve audio files statically
    this.app.use('/audio', express.static(this.audioDir, {
      setHeaders: (res, path) => {
        res.set('Content-Type', 'audio/wav');
        res.set('Accept-Ranges', 'bytes');
      }
    }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', audioDir: this.audioDir });
    });

    // List audio files (for debugging)
    this.app.get('/audio-list', (req, res) => {
      const fs = require('fs');
      fs.readdir(this.audioDir, (err: any, files: string[]) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ files });
        }
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        this.logger.info(`Audio server listening on http://0.0.0.0:${this.port}`);
        this.logger.info(`Serving audio files from: ${this.audioDir}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Audio server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getAudioUrl(filename: string): string {
    // Return the HTTP URL that Asterisk can use to fetch the file
    const basename = path.basename(filename);

    // Get the server's IP address
    const serverIp = this.getServerIp();

    return `http://${serverIp}:${this.port}/audio/${basename}`;
  }

  private getServerIp(): string {
    // Try to get the actual server IP
    const os = require('os');
    const interfaces = os.networkInterfaces();

    // Look for non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }

    // Fallback to localhost if no external interface found
    return '127.0.0.1';
  }
}
