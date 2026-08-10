import { createRequire } from 'node:module';
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
import { AuthSessionManager, extractAuthToken, type SessionContext, type AuthRequestHeaders } from './auth.js';

let cachedUWS: any = undefined;

export function loadUWS(): any {
  if (cachedUWS !== undefined) {
    return cachedUWS;
  }
  try {
    const req = createRequire(import.meta.url);
    cachedUWS = req('uWebSockets.js');
  } catch {
    cachedUWS = null;
  }
  return cachedUWS;
}

export function isUWSAvailable(): boolean {
  const uWS = loadUWS();
  return uWS !== null && typeof uWS.App === 'function';
}

export class UWSServerDriver implements IServerDriver {
  public readonly kind = 'uws' as const;
  public onConnection?: ServerOnConnection;
  public onMessage?: ServerOnMessage;
  public onClose?: ServerOnClose;
  public onDrain?: ServerOnDrain;
  public onError?: ServerOnError;

  public port?: number;
  public host?: string;

  private app: any = null;
  private listenSocket: any = null;
  private connections = new Map<string, any>();
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

    const uWS = loadUWS();
    if (!uWS) {
      throw new Error('uWebSockets.js native binding is not available in this environment.');
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.app = uWS.App(this.options);
        const wsOptions: any = {
          compression: this.options.compression ?? uWS.SHARED_COMPRESSOR,
          maxPayloadLength: this.options.maxPayloadLength ?? 16 * 1024 * 1024,
          idleTimeout: this.options.idleTimeout ?? 120,
          open: (ws: any) => {
            const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
            ws.id = id;
            this.connections.set(id, ws);
            if (this.auth.enabled && ws.getUserData?.().authContext) this.auth.associate(id, ws.getUserData().authContext);
            this.onConnection?.(id);
          },
          message: (ws: any, message: ArrayBuffer, isBinary: boolean) => {
            /**
             * CRITICAL MEMORY CORRECTION CONTRACT:
             * uWebSockets.js reuses its internal ArrayBuffer allocation across consecutive
             * message callbacks. To prevent memory corruption or race conditions where
             * downstream handlers read mutated/overwritten data asynchronously,
             * we MUST make a safe, detached copy of the incoming message buffer using
             * `copyBuffer(message)` (which calls `buf.slice(0)`) BEFORE passing it to onMessage.
             */
            const copy = copyBuffer(message);
            if (ws.id) {
              void this.auth.handleFrame(ws.id, copy, payload => this.send(ws.id, payload));
              this.onMessage?.(ws.id, copy);
            }
          },
          close: (ws: any, code: number, message: ArrayBuffer) => {
            const id = ws.id;
            if (id) {
              this.connections.delete(id);
              this.auth.remove(id);
              const reason = message && message.byteLength > 0 ? Buffer.from(message).toString('utf8') : '';
              this.onClose?.(id, code, reason);
            }
          },
          drain: (ws: any) => {
            if (ws.id) this.onDrain?.(ws.id);
          }
        };
        if (this.auth.enabled) {
          wsOptions.upgrade = (res: any, req: any, context: any) => {
            res.onAborted?.(() => undefined);
            const headers: AuthRequestHeaders = { cookie: req.getHeader('cookie'), 'sec-websocket-protocol': req.getHeader('sec-websocket-protocol') };
            void this.auth.authenticateHeaders('handshake', headers).then(authContext => {
              if (!authContext && this.auth.required) { res.writeStatus('401 Unauthorized').end(); return; }
              res.upgrade({ authContext }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), context);
            }).catch(() => res.writeStatus('401 Unauthorized').end());
          };
        }
        this.app.ws('/*', wsOptions);

        const listenCallback = (token: any) => {
          if (token) {
            this.listenSocket = token;
            if (uWS.us_socket_local_port) {
              this.port = uWS.us_socket_local_port(token);
            }
            resolve();
          } else {
            reject(new Error(`uWebSockets.js failed to listen on ${this.host}:${this.port}`));
          }
        };

        if (this.host && this.host !== '0.0.0.0' && this.host !== '::') {
          this.app.listen(this.host, this.port, listenCallback);
        } else {
          this.app.listen(this.port, listenCallback);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  public send(connectionId: string, data: Uint8Array): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws) {
      return false;
    }
    const result = ws.send(data, true);
    return result === 1 || result === true;
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

    if (this.listenSocket) {
      const uWS = loadUWS();
      if (uWS && uWS.us_listen_socket_close) {
        uWS.us_listen_socket_close(this.listenSocket);
      }
      this.listenSocket = null;
    }
  }

  public getBufferedAmount(connectionId?: string): number {
    if (connectionId) {
      const ws = this.connections.get(connectionId);
      return ws ? (typeof ws.getBufferedAmount === 'function' ? ws.getBufferedAmount() : 0) : 0;
    }
    let total = 0;
    for (const ws of this.connections.values()) {
      if (typeof ws.getBufferedAmount === 'function') {
        total += ws.getBufferedAmount();
      }
    }
    return total;
  }
}

export const uwsDriver = UWSServerDriver;
