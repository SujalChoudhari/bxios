import type {
  InterceptorFulfilled,
  InterceptorHandler,
  InterceptorOptions,
  InterceptorRejected,
} from './types.js';

export class InterceptorManager<V> {
  private handlers: Array<InterceptorHandler<V> | null> = [];

  /**
   * Register a new interceptor in the chain.
   * Supports async fulfilled and rejected functions.
   * Returns a numeric ID used to eject the interceptor later.
   */
  public use(
    fulfilled: InterceptorFulfilled<V>,
    rejected?: InterceptorRejected,
    options?: InterceptorOptions
  ): number {
    this.handlers.push({
      fulfilled,
      rejected,
      synchronous: options?.synchronous ?? false,
      runWhen: options?.runWhen,
    });
    return this.handlers.length - 1;
  }

  /**
   * Remove an interceptor by ID.
   */
  public eject(id: number): void {
    if (this.handlers[id] !== undefined) {
      this.handlers[id] = null;
    }
  }

  /**
   * Clear all interceptors.
   */
  public clear(): void {
    this.handlers = [];
  }

  /**
   * Iterate over active interceptors.
   */
  public forEach(fn: (handler: InterceptorHandler<V>) => void): void {
    for (const handler of this.handlers) {
      if (handler !== null) {
        fn(handler);
      }
    }
  }

  /**
   * Get active interceptor count.
   */
  public get length(): number {
    return this.handlers.filter((h) => h !== null).length;
  }
}
