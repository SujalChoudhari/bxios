import { WebSocketServer, WebSocket, RawData } from 'ws';
import { copyBuffer } from './buffer.js';
import {
  IServerDriver,
  ServerDriverHandlers,
  ServerDriverOptions,
  ServerOnConnection,
  ServerOnMessage,
  ServerOnClose,
  ServerOnDrain,
  ServerOnError,
  parseListenArgs
} from './types.js';
import { AuthSessionManager, type SessionContext } from './auth.js';

export class WSServerDriver implements IServerDriver {
  public readonly kind = 'ws' as const;
  public onConnection?: ServerOnConnection;
  public onMessage?: ServerOnMessage;
  public onClose?: ServerOnClose;
  public onDrain?: ServerOnDrain;
  public onError?: ServerOnError;

  public port?: number;
  public host?: string;

  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WebSocket>();
  private options: ServerDriverOptions;
  private auth: AuthSessionManager;

  constructor(options: ServerDriverOptions = {}) {
    this.options = options;
    this.auth = new AuthSessionManager(options.auth);
  }

  public getSessionContext(connectionId: string): SessionContext | undefined { return this.auth.get(connectionId); }

  public async listen(
    hostOrPort?: string | number | ServerDriverOptions,
    portOrHostOrHandlers?: number | string | ServerDriverHandlers,
    handlers?: ServerDriverHandlers
  ): Promise<void> {
    const parsed = parseListenArgs(hostOrPort, portOrHostOrHandlers, handlers);
    this.host = parsed.host;
    this.port = parsed.port;

    if (parsed.handlers) {
      if (parsed.handlers.onConnection) this.onConnection = parsed.handlers.onConnection;
      if (parsed.handlers.onMessage) {
        const previous = this.onMessage;
        this.onMessage = (connectionId, data) => {
          previous?.(connectionId, data);
          parsed.handlers!.onMessage!(connectionId, data);
        };
      }
      if (parsed.handlers.onClose) {
        const previous = this.onClose;
        this.onClose = (connectionId, code, message) => {
          previous?.(connectionId, code, message);
          parsed.handlers!.onClose!(connectionId, code, message);
        };
      }
      if (parsed.handlers.onDrain) {
        const previous = this.onDrain;
        this.onDrain = (connectionId) => {
          previous?.(connectionId);
          parsed.handlers!.onDrain!(connectionId);
        };
      }
      if (parsed.handlers.onError) this.onError = parsed.handlers.onError;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.wss = new WebSocketServer(
          {
            port: this.port,
            host: this.host,
            ...this.options,
            ...(this.auth.enabled ? { verifyClient: (info: any, done: (verified: boolean) => void) => {
              void this.auth.authenticateHeaders('handshake', info.req.headers).then(context => {
                done(!!context || !this.auth.required);
              }).catch(() => done(false));
            } } : {})
          },
          () => {
            const addr = this.wss?.address();
            if (addr && typeof addr === 'object') {
              this.port = addr.port;
              this.host = addr.address;
            }
            resolve();
          }
        );

        this.wss.on('error', (err) => {
          reject(err);
        });

        this.wss.on('connection', async (ws: WebSocket, request: any) => {
          const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
          this.connections.set(id, ws);
          if (this.auth.enabled) await this.auth.authenticateHeaders(id, request.headers);
          this.onConnection?.(id);

          (ws as any)._socket?.on('drain', () => this.onDrain?.(id));

          ws.on('message', (data: RawData, isBinary: boolean) => {
            /**
             * UNIFORM BUFFER COPY CONTRACT:
             * Although `ws` allocates standard Node.js Buffer instances,
             * we enforce the same `copyBuffer` memory isolation contract across
             * all server drivers for consistent behavior and zero side effects.
             */
            const copy = copyBuffer(data as Buffer);
            void this.auth.handleFrame(id, copy, payload => this.send(id, payload));
            this.onMessage?.(id, copy);
          });

          ws.on('close', (code: number, reason: Buffer) => {
            this.connections.delete(id);
            this.auth.remove(id);
            const reasonStr = reason ? reason.toString('utf8') : '';
            this.onClose?.(id, code, reasonStr);
          });

          ws.on('error', (err: Error) => {
            this.onError?.(id, err);
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public send(connectionId: string, data: Uint8Array): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(data);
    return true;
  }

  public async close(connectionId?: string): Promise<void> {
    if (connectionId) {
      const ws = this.connections.get(connectionId);
      if (ws) {
        ws.close();
        this.connections.delete(connectionId);
      }
      return;
    }

    for (const [id, ws] of this.connections.entries()) {
      try {
        ws.close();
      } catch {}
    }
    this.connections.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
  }

  public getBufferedAmount(connectionId?: string): number {
    if (connectionId) {
      const ws = this.connections.get(connectionId);
      return ws ? ws.bufferedAmount : 0;
    }
    let total = 0;
    for (const ws of this.connections.values()) {
      total += ws.bufferedAmount;
    }
    return total;
  }
}

export const wsDriver = WSServerDriver;
