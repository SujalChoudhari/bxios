import type { AxiosLikeError, PendingMapOptions, PendingRequest } from './types.js';

export function createTimeoutError(timeoutMs: number, config?: Record<string, any>): AxiosLikeError {
  const message = `timeout of ${timeoutMs}ms exceeded`;
  const err = new Error(message) as AxiosLikeError;
  err.name = 'AxiosError';
  err.code = 'ECONNABORTED';
  err.config = config ?? {};
  err.isAxiosError = true;
  err.statusCode = 408;
  return err;
}

export function createDisconnectError(reason?: any): any {
  if (reason !== undefined) {
    return reason;
  }
  const message = 'Client disconnected (ECONNRESET)';
  const err = new Error(message) as AxiosLikeError;
  err.name = 'AxiosError';
  err.code = 'ECONNRESET';
  err.config = {};
  err.isAxiosError = true;
  err.statusCode = 503;
  return err;
}

export class PendingMap {
  private map = new Map<string, PendingRequest>();
  private defaultTimeout: number;

  constructor(options?: PendingMapOptions | number) {
    if (typeof options === 'number') {
      this.defaultTimeout = options;
    } else {
      this.defaultTimeout = options?.defaultTimeout ?? 0;
    }
  }

  /**
   * Sets the instance-level default timeout in milliseconds.
   */
  public setTimeout(ms: number): void {
    this.defaultTimeout = ms;
  }

  /**
   * Gets the instance-level default timeout in milliseconds.
   */
  public getTimeout(): number {
    return this.defaultTimeout;
  }

  /**
   * Registers a pending request and starts a timeout timer if a timeout is configured.
   */
  public add(id: string, pending: Omit<PendingRequest, 'id'>, timeoutMs?: number): void {
    // If the request ID already exists in the map, reject the previous entry to prevent memory leaks
    if (this.map.has(id)) {
      this.reject(id, new Error(`Duplicate pending request ID: ${id}`));
    }

    const effectiveTimeout = timeoutMs ?? pending.timeout ?? this.defaultTimeout;

    const fullPending: PendingRequest = {
      id,
      resolve: pending.resolve,
      reject: pending.reject,
      config: pending.config,
      timeout: effectiveTimeout,
      ...pending,
    };

    if (effectiveTimeout && effectiveTimeout > 0) {
      fullPending.timer = setTimeout(() => {
        if (this.map.has(id)) {
          this.map.delete(id);
          const error = createTimeoutError(effectiveTimeout, pending.config);
          pending.reject(error);
        }
      }, effectiveTimeout);
    }

    this.map.set(id, fullPending);
  }

  /**
   * Resolves a pending request with a given value, clearing its timer and removing it from the map.
   */
  public resolve(id: string, value: any): void {
    const item = this.map.get(id);
    if (!item) return;

    if (item.timer) {
      clearTimeout(item.timer);
    }
    this.map.delete(id);
    item.resolve(value);
  }

  /**
   * Rejects a pending request with a given reason, clearing its timer and removing it from the map.
   */
  public reject(id: string, reason: any): void {
    const item = this.map.get(id);
    if (!item) return;

    if (item.timer) {
      clearTimeout(item.timer);
    }
    this.map.delete(id);
    item.reject(reason);
  }

  /**
   * Gets the pending request associated with the specified ID.
   */
  public get(id: string): PendingRequest | undefined {
    return this.map.get(id);
  }

  /**
   * Checks whether a request with the specified ID is currently pending.
   */
  public has(id: string): boolean {
    return this.map.has(id);
  }

  /**
   * Returns the current number of pending requests.
   */
  public get size(): number {
    return this.map.size;
  }

  /**
   * Tears down all pending requests, clearing timers, rejecting promises, and emptying the map.
   */
  public teardown(reason?: any): void {
    const disconnectError = createDisconnectError(reason);
    const pendingItems = Array.from(this.map.values());
    this.map.clear();

    for (const item of pendingItems) {
      if (item.timer) {
        clearTimeout(item.timer);
      }
      item.reject(disconnectError);
    }
  }

  /**
   * Clears all pending requests (alias for teardown).
   */
  public clear(reason?: any): void {
    this.teardown(reason);
  }
}

/**
 * Factory function to create a new PendingMap instance.
 */
export function createPendingMap(options?: PendingMapOptions | number): PendingMap {
  return new PendingMap(options);
}
