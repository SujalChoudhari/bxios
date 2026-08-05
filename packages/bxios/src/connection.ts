import type { IDriver, DriverOnMessage, DriverOnConnect, DriverOnClose, DriverOnDrain } from '@bxios/wire';
import type { ConnectionManagerOptions, ConnectionState } from './types.js';

export class ConnectionManager implements IDriver {
  private socket: any = null;
  private url: string;
  private options: ConnectionManagerOptions;
  private state: ConnectionState = 'DISCONNECTED';
  private reconnectAttempt = 0;
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private pongTimeoutTimer: any = null;
  private isManualClose = false;

  public onMessage?: DriverOnMessage;
  public onConnect?: DriverOnConnect;
  public onClose?: DriverOnClose;
  public onDrain?: DriverOnDrain;

  public onReconnectAttempt?: (attempt: number, delay: number) => void;
  public onPing?: () => void;
  public onPong?: () => void;

  constructor(options?: ConnectionManagerOptions | string) {
    if (typeof options === 'string') {
      this.options = { url: options };
      this.url = options;
    } else {
      this.options = options ?? {};
      this.url = this.options.url ?? '';
    }
  }

  public getStatus(): ConnectionState {
    return this.state;
  }

  public getSocket(): any {
    return this.socket;
  }

  public getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  public listen(options?: { url?: string } | string): void {
    if (typeof options === 'string') {
      this.url = options;
    } else if (options?.url) {
      this.url = options.url;
    }
    this.connect();
  }

  public connect(url?: string): void {
    if (url) {
      this.url = url;
    }

    if (!this.url) {
      throw new Error('WebSocket URL is required');
    }

    this.isManualClose = false;
    this.clearReconnectTimer();

    const WebSocketCtor = this.options.webSocketImpl || (globalThis as any).WebSocket;
    if (!WebSocketCtor) {
      throw new Error(
        'WebSocket constructor not found. Please provide webSocketImpl in options or run in an environment with global WebSocket.'
      );
    }

    this.state = this.reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING';

    try {
      if (this.options.protocols) {
        this.socket = new WebSocketCtor(this.url, this.options.protocols);
      } else {
        this.socket = new WebSocketCtor(this.url);
      }

      // Acceptance Criteria 1: Enforce binaryType = 'arraybuffer' on native WebSocket instances
      if ('binaryType' in this.socket || typeof this.socket.binaryType !== 'undefined' || this.socket) {
        try {
          this.socket.binaryType = 'arraybuffer';
        } catch (e) {
          // Ignore if binaryType property setter is disallowed in custom mock
        }
      }

      this.socket.onopen = () => {
        this.state = 'CONNECTED';
        this.reconnectAttempt = 0;
        this.startHeartbeat();

        if (this.onConnect) {
          this.onConnect();
        }
      };

      this.socket.onmessage = (event: any) => {
        const rawData = event.data !== undefined ? event.data : event;
        let buffer: Uint8Array;

        if (rawData instanceof Uint8Array) {
          buffer = rawData;
        } else if (rawData instanceof ArrayBuffer) {
          buffer = new Uint8Array(rawData);
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawData)) {
          buffer = new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        } else if (typeof rawData === 'string') {
          buffer = new TextEncoder().encode(rawData);
        } else {
          buffer = new Uint8Array(0);
        }

        // Check if message is a pong response
        if (this.isPongMessage(buffer, rawData)) {
          this.handlePong();
          return;
        }

        if (this.onMessage) {
          this.onMessage(buffer);
        }
      };

      this.socket.onerror = (_error: any) => {
        // Errors will trigger onclose or can be handled as error disconnect
      };

      this.socket.onclose = (event: any) => {
        const hadError = this.state === 'CONNECTING' || (event && event.wasClean === false);
        this.handleClose(hadError);
      };
    } catch (err) {
      this.handleClose(true);
    }
  }

  public send(data: Uint8Array): void {
    if (!this.socket || this.state !== 'CONNECTED') {
      throw new Error('Cannot send message: WebSocket is not connected');
    }
    this.socket.send(data);
  }

  public close(): void {
    this.disconnect();
  }

  public disconnect(): void {
    this.isManualClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.state = 'DISCONNECTED';

    if (this.socket) {
      try {
        if (typeof this.socket.close === 'function') {
          this.socket.close();
        }
      } catch (e) {
        // Ignore close error
      }
      this.socket = null;
    }
  }

  public getBufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0;
  }

  /**
   * Exponential backoff reconnect loop (1s to 30s cap)
   */
  public calculateReconnectDelay(attempt: number): number {
    const minDelay = this.options.minReconnectDelay ?? 1000; // 1s default
    const maxDelay = this.options.maxReconnectDelay ?? 30000; // 30s cap default
    const factor = this.options.reconnectFactor ?? 2;

    const delay = minDelay * Math.pow(factor, attempt);
    return Math.min(delay, maxDelay);
  }

  private handleClose(hadError: boolean): void {
    this.stopHeartbeat();
    this.state = 'DISCONNECTED';

    if (this.onClose) {
      this.onClose(hadError);
    }

    const autoReconnect = this.options.autoReconnect ?? true;
    if (!this.isManualClose && autoReconnect) {
      const delay = this.calculateReconnectDelay(this.reconnectAttempt);
      this.reconnectAttempt++;
      this.state = 'RECONNECTING';

      if (this.onReconnectAttempt) {
        this.onReconnectAttempt(this.reconnectAttempt, delay);
      }

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 30-second ping/pong heartbeat timer to prevent proxy idle dropouts
   */
  public startHeartbeat(): void {
    this.stopHeartbeat();

    const interval = this.options.pingInterval ?? 30000; // 30s default
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, interval);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  public sendPing(): void {
    if (!this.socket || this.state !== 'CONNECTED') {
      return;
    }

    if (this.onPing) {
      this.onPing();
    }

    if (typeof this.socket.ping === 'function') {
      this.socket.ping();
    } else {
      let payload: Uint8Array | string;
      if (typeof this.options.pingPayload === 'function') {
        payload = this.options.pingPayload();
      } else if (this.options.pingPayload) {
        payload = this.options.pingPayload;
      } else {
        payload = new Uint8Array([0x9]); // Ping byte payload
      }

      try {
        this.socket.send(payload);
      } catch (e) {
        // Ignore send errors during ping
      }
    }

    if (this.options.pingTimeout && this.options.pingTimeout > 0) {
      this.pongTimeoutTimer = setTimeout(() => {
        if (this.socket) {
          try {
            this.socket.close();
          } catch (e) {}
        }
      }, this.options.pingTimeout);
    }
  }

  public handlePong(): void {
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
    if (this.onPong) {
      this.onPong();
    }
  }

  private isPongMessage(buffer: Uint8Array, rawData: any): boolean {
    if (buffer.length === 1 && buffer[0] === 0x0a) {
      return true; // 0x0a = Pong frame byte
    }
    if (typeof rawData === 'string' && rawData === 'pong') {
      return true;
    }
    return false;
  }
}

export function createConnectionManager(options?: ConnectionManagerOptions | string): ConnectionManager {
  return new ConnectionManager(options);
}
