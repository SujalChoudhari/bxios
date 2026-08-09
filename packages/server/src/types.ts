export type ServerOnConnection = (connectionId: string) => void;
export type ServerOnMessage = (connectionId: string, data: Uint8Array) => void;
export type ServerOnClose = (connectionId: string, code?: number, message?: string) => void;
export type ServerOnDrain = (connectionId: string) => void;
export type ServerOnError = (connectionId: string, error: Error) => void;

export interface ServerDriverHandlers {
  onConnection?: ServerOnConnection;
  onMessage?: ServerOnMessage;
  onClose?: ServerOnClose;
  onDrain?: ServerOnDrain;
  onError?: ServerOnError;
}

export interface ServerDriverOptions {
  port?: number;
  host?: string;
  idleTimeout?: number;
  maxPayloadLength?: number;
  compression?: number;
  auth?: import('./auth.js').ServerAuthOptions;
  [key: string]: any;
}

export interface IServerDriver {
  readonly kind: 'uws' | 'ws';
  onConnection?: ServerOnConnection;
  onMessage?: ServerOnMessage;
  onClose?: ServerOnClose;
  onDrain?: ServerOnDrain;
  onError?: ServerOnError;

  port?: number;
  host?: string;

  listen(
    hostOrPort?: string | number | ServerDriverOptions,
    portOrHostOrHandlers?: number | string | ServerDriverHandlers,
    handlers?: ServerDriverHandlers
  ): Promise<void> | void;

  send(connectionId: string, data: Uint8Array): boolean | void;
  close(connectionId?: string): Promise<void> | void;
  getBufferedAmount(connectionId?: string): number;
  getSessionContext?(connectionId: string): import('./auth.js').SessionContext | undefined;
}

export type ServerDriver = IServerDriver;

export function parseListenArgs(
  hostOrPort?: string | number | ServerDriverOptions,
  portOrHostOrHandlers?: number | string | ServerDriverHandlers,
  handlers?: ServerDriverHandlers
): { host: string; port: number; handlers?: ServerDriverHandlers } {
  let host = '127.0.0.1';
  let port = 0;
  let h = handlers;

  if (typeof hostOrPort === 'number') {
    port = hostOrPort;
    if (typeof portOrHostOrHandlers === 'string') {
      host = portOrHostOrHandlers;
    } else if (typeof portOrHostOrHandlers === 'object' && portOrHostOrHandlers !== null) {
      h = portOrHostOrHandlers as ServerDriverHandlers;
    }
  } else if (typeof hostOrPort === 'string') {
    host = hostOrPort;
    if (typeof portOrHostOrHandlers === 'number') {
      port = portOrHostOrHandlers;
    }
  } else if (typeof hostOrPort === 'object' && hostOrPort !== null) {
    const opts = hostOrPort as ServerDriverOptions;
    if (opts.host) host = opts.host;
    if (typeof opts.port === 'number') port = opts.port;
  }

  if (!h && typeof portOrHostOrHandlers === 'object' && portOrHostOrHandlers !== null) {
    h = portOrHostOrHandlers as ServerDriverHandlers;
  }

  return { host, port, handlers: h };
}
