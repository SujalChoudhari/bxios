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
