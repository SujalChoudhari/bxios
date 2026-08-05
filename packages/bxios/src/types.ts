export interface PendingRequest<T = any> {
  id: string;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  timer?: ReturnType<typeof setTimeout>;
  timeout?: number;
  config?: Record<string, any>;
  createdAt?: number;
  [key: string]: any;
}

export interface PendingMapOptions {
  /** Default timeout in milliseconds for pending requests. 0 or undefined means no timeout. */
  defaultTimeout?: number;
}

export interface AxiosLikeError extends Error {
  code: string;
  message: string;
  config?: Record<string, any>;
  isAxiosError: boolean;
  statusCode: number;
}

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface ConnectionManagerOptions {
  /** The WebSocket URL to connect to. */
  url?: string;
  /** Custom WebSocket implementation constructor (e.g. Node `ws`). Defaults to `globalThis.WebSocket`. */
  webSocketImpl?: any;
  /** WebSocket subprotocols */
  protocols?: string | string[];
  /** Enable automatic exponential backoff reconnection. Default: true */
  autoReconnect?: boolean;
  /** Minimum reconnect delay in ms. Default: 1000 (1s) */
  minReconnectDelay?: number;
  /** Maximum reconnect delay in ms. Default: 30000 (30s) */
  maxReconnectDelay?: number;
  /** Reconnect delay multiplier factor. Default: 2 */
  reconnectFactor?: number;
  /** Heartbeat ping interval in ms. Default: 30000 (30s) */
  pingInterval?: number;
  /** Heartbeat timeout waiting for pong response in ms. Default: 5000 */
  pingTimeout?: number;
  /** Custom ping payload (or payload generator) to send on ping. Default: Uint8Array([0x9]) */
  pingPayload?: Uint8Array | string | (() => Uint8Array | string);
}

export interface AxiosRequestConfig<D = any> {
  url?: string;
  method?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: D;
  timeout?: number;
  signal?: AbortSignal;
  adapter?: (config: AxiosRequestConfig<D>) => Promise<AxiosResponse<any, D>>;
  [key: string]: any;
}

export interface AxiosResponse<T = any, D = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: AxiosRequestConfig<D>;
  request?: any;
}

export type InterceptorFulfilled<T> = (value: T) => T | Promise<T>;
export type InterceptorRejected = (error: any) => any;

export interface InterceptorOptions {
  synchronous?: boolean;
  runWhen?: (config: AxiosRequestConfig) => boolean;
}

export interface InterceptorHandler<T> {
  fulfilled: InterceptorFulfilled<T>;
  rejected?: InterceptorRejected;
  synchronous?: boolean;
  runWhen?: (config: AxiosRequestConfig) => boolean;
}

