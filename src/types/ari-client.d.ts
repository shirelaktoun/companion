/**
 * Type definitions for ari-client
 * The ari-client package doesn't include TypeScript definitions
 */

declare module 'ari-client' {
  import { EventEmitter } from 'events';

  export interface Client extends EventEmitter {
    start(appName: string): void;
    Channel(id?: string): Channel;
    Playback(id?: string): Playback;
    LiveRecording(name: string): LiveRecording;
    on(event: 'StasisStart', handler: (event: StasisStart, channel: Channel) => void): this;
    on(event: 'ChannelStateChange', handler: (event: any, channel: Channel) => void): this;
    on(event: 'ChannelHangupRequest', handler: (event: any, channel: Channel) => void): this;
    on(event: 'ChannelDestroyed', handler: (event: any, channel: Channel) => void): this;
    on(event: 'error', handler: (error: Error) => void): this;
    on(event: string, handler: (...args: any[]) => void): this;
  }

  export interface Channel {
    id: string;
    name: string;
    state: string;
    caller: {
      name: string;
      number: string;
    };
    connected: {
      name: string;
      number: string;
    };
    answer(): Promise<void>;
    hangup(): Promise<void>;
    play(options: { media: string }, playback?: Playback): Promise<void>;
    record(options: RecordOptions): Promise<void>;
    originate(options: OriginateOptions): Promise<void>;
    externalMedia(options: ExternalMediaOptions): Promise<any>;
  }

  export interface StasisStart {
    type: string;
    application: string;
    timestamp: string;
    args: string[];
    channel: Channel;
  }

  export interface Playback {
    id: string;
    media_uri: string;
    state: string;
  }

  export interface LiveRecording {
    name: string;
    format: string;
    state: string;
    stop(): Promise<void>;
  }

  export interface RecordOptions {
    name: string;
    format: string;
    maxDurationSeconds?: number;
    maxSilenceSeconds?: number;
    ifExists?: 'fail' | 'overwrite' | 'append';
    beep?: boolean;
    terminateOn?: string;
  }

  export interface OriginateOptions {
    endpoint: string;
    app?: string;
    appArgs?: string;
    callerId?: string;
    timeout?: number;
    variables?: { [key: string]: string };
  }

  export interface ExternalMediaOptions {
    app: string;
    external_host: string;
    format: string;
    encapsulation?: string;
    transport?: string;
    connection_type?: string;
    direction?: string;
  }

  export function connect(
    url: string,
    username: string,
    password: string
  ): Promise<Client>;

  export default { connect };
}
