import {
  decodeStreamValue,
  createStreamChunkFrame,
  createStreamEndFrame,
  createStreamStartFrame,
  decodeFrame,
  encodeFrame,
  FrameType,
  type StreamRequest,
} from '@bxios/wire';
import type { IServerDriver } from './types.js';
import type { RouteRegistry, RequestContext } from './router.js';
import { isErrorTupleFrame } from './validation.js';

export type StreamingValue = AsyncIterable<unknown> | Iterable<unknown> | ReadableStream<unknown>;
export type StreamingHandler = (
  request: RequestContext,
  signal: AbortSignal,
) => StreamingValue | Promise<StreamingValue>;

export interface MultiplexedStreamingEngineOptions {
  router?: RouteRegistry;
  handler?: StreamingHandler;
  /** Maximum buffered bytes before the next streaming frame waits. */
  backpressureHighWaterMark?: number;
  /** How often a blocked send checks the driver buffer. */
  backpressurePollIntervalMs?: number;
  /** Maximum time a blocked send may wait before failing the stream. */
  backpressureTimeoutMs?: number;
  /** Maximum time allowed for iterator/reader cleanup after cancellation. */
  cancellationTimeoutMs?: number;
  /** Called when an iterator does not complete cleanup within the bound. */
  onCancellationTimeout?: (connectionId: string, streamId: number) => void;
}

interface ActiveStream {
  controller: AbortController;
  iterator?: AsyncIterator<unknown>;
  cancellation?: Promise<void>;
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function toAsyncIterator(value: unknown): Promise<AsyncIterator<unknown>> {
  if (value && typeof (value as any)[Symbol.asyncIterator] === 'function') return (value as any)[Symbol.asyncIterator]();
  if (value && typeof (value as any)[Symbol.iterator] === 'function') return (value as any)[Symbol.iterator]();
  if (value && typeof (value as any).getReader === 'function') {
    const reader = (value as ReadableStream<unknown>).getReader();
    return {
      next: async () => {
        const result = await reader.read();
        return result.done ? result : { done: false, value: result.value };
      },
      return: async () => {
        await reader.cancel();
        return { done: true, value: undefined };
      },
    };
  }
  throw new TypeError('Stream handler must return an AsyncIterable, Iterable, or ReadableStream');
}

export class MultiplexedStreamingEngine {
  private active = new Map<string, ActiveStream>();
  private previousOnMessage?: IServerDriver['onMessage'];
  private previousOnClose?: IServerDriver['onClose'];
  private readonly options: Required<Pick<MultiplexedStreamingEngineOptions, 'backpressureHighWaterMark' | 'backpressurePollIntervalMs' | 'backpressureTimeoutMs' | 'cancellationTimeoutMs'>> & MultiplexedStreamingEngineOptions;

  constructor(private readonly driver: IServerDriver, options: MultiplexedStreamingEngineOptions = {}) {
    this.options = {
      backpressureHighWaterMark: 1024 * 1024,
      backpressurePollIntervalMs: 5,
      backpressureTimeoutMs: 30_000,
      cancellationTimeoutMs: 1_000,
      ...options,
    };
    this.previousOnMessage = driver.onMessage;
    this.previousOnClose = driver.onClose;
    driver.onMessage = (connectionId, data) => {
      try {
        this.previousOnMessage?.(connectionId, data);
      } finally {
        void this.handleMessage(connectionId, data).catch(() => undefined);
      }
    };
    driver.onClose = (connectionId, code, message) => {
      try {
        this.previousOnClose?.(connectionId, code, message);
      } finally {
        this.cancelConnection(connectionId);
      }
    };
  }

  public async handleMessage(connectionId: string, data: Uint8Array): Promise<void> {
    let frame;
    try {
      frame = decodeFrame(data);
      if (frame.type === FrameType.StreamCancel && frame.streamId !== undefined) {
        this.cancel(connectionId, frame.streamId);
        return;
      }
      if (frame.type !== FrameType.StreamStart || frame.streamId === undefined) return;

      const payload = decodeStreamValue<{ request?: StreamRequest }>(frame.data);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Invalid stream start payload');
      const request = payload.request ?? {};
      const key = `${connectionId}:${frame.streamId}`;
      if (this.active.has(key)) return;

      const active: ActiveStream = { controller: new AbortController() };
      this.active.set(key, active);
      await this.send(connectionId, encodeFrame(createStreamStartFrame(frame.id, frame.streamId, request)));
      void this.run(connectionId, frame.id, frame.streamId, key, request, active).catch(() => undefined);
    } catch (error: any) {
      if (frame?.type === FrameType.StreamStart && frame.streamId !== undefined) {
        await this.safeSendEnd(connectionId, frame.id, frame.streamId, error?.statusCode ?? 400, error?.message ?? 'Malformed stream start payload');
      }
    }
  }

  private async run(connectionId: string, id: string, streamId: number, key: string, request: StreamRequest, active: ActiveStream): Promise<void> {
    try {
      const handlerResult = this.options.handler
        ? Promise.resolve().then(() => this.options.handler!(request as RequestContext, active.controller.signal))
        : this.options.router
          ? Promise.resolve().then(() => this.options.router!.handle({ ...request, id, frameId: id, signal: active.controller.signal } as RequestContext))
          : Promise.reject(new Error('Streaming engine requires a handler or router'));
      const value = await this.raceAbort(handlerResult, active.controller.signal);
      if (value === undefined || active.controller.signal.aborted) return;
      if (this.options.router && isErrorTupleFrame(value)) {
        await this.send(connectionId, encodeFrame(createStreamEndFrame(
          id,
          streamId,
          value.code,
          value.metadata,
        )));
        return;
      }
      active.iterator = await toAsyncIterator(value);

      while (!active.controller.signal.aborted) {
        const next = await this.raceAbort(Promise.resolve().then(() => active.iterator!.next()), active.controller.signal);
        if (next === undefined || next.done || active.controller.signal.aborted) break;
        await this.send(connectionId, encodeFrame(createStreamChunkFrame(id, streamId, next.value)));
      }
      if (!active.controller.signal.aborted) await this.send(connectionId, encodeFrame(createStreamEndFrame(id, streamId)));
    } catch (error: any) {
      if (!active.controller.signal.aborted) await this.safeSendEnd(connectionId, id, streamId, error?.statusCode ?? 500, error?.message ?? 'Stream failed');
    } finally {
      if (active.controller.signal.aborted) await this.cleanupCancellation(connectionId, streamId, active);
      this.active.delete(key);
    }
  }

  private async raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
    let abort: (() => void) | undefined;
    const aborted = new Promise<undefined>((resolve) => {
      abort = () => resolve(undefined);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
    operation.catch(() => undefined);
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  }

  private async cleanupCancellation(connectionId: string, streamId: number, active: ActiveStream): Promise<void> {
    if (active.cancellation) return active.cancellation;
    active.cancellation = (async () => {
      const cleanup = active.iterator?.return ? Promise.resolve().then(() => active.iterator!.return!()) : Promise.resolve();
      cleanup.catch(() => undefined);
      let timedOut = false;
      await Promise.race([cleanup.catch(() => undefined), delay(this.options.cancellationTimeoutMs).then(() => { timedOut = true; })]);
      if (timedOut) this.options.onCancellationTimeout?.(connectionId, streamId);
    })();
    return active.cancellation;
  }

  private async send(connectionId: string, data: Uint8Array): Promise<void> {
    const deadline = Date.now() + this.options.backpressureTimeoutMs;
    while (this.driver.getBufferedAmount(connectionId) > this.options.backpressureHighWaterMark) {
      if (Date.now() >= deadline) throw new Error('Stream backpressure timeout');
      await delay(this.options.backpressurePollIntervalMs);
    }
    if (this.driver.send(connectionId, data) === false) throw new Error('Stream send failed');
  }

  private async safeSendEnd(connectionId: string, id: string, streamId: number, code: number, message: string): Promise<void> {
    try { await this.send(connectionId, encodeFrame(createStreamEndFrame(id, streamId, code, { message }))); } catch { /* connection may already be closed */ }
  }

  public cancel(connectionId: string, streamId: number): void {
    const active = this.active.get(`${connectionId}:${streamId}`);
    if (!active) return;
    active.controller.abort();
    void this.cleanupCancellation(connectionId, streamId, active).catch(() => undefined);
  }

  private cancelConnection(connectionId: string): void {
    for (const [key, active] of this.active) if (key.startsWith(`${connectionId}:`)) {
      active.controller.abort();
      void this.cleanupCancellation(connectionId, Number(key.slice(connectionId.length + 1)), active).catch(() => undefined);
    }
  }
}

export const StreamingServer = MultiplexedStreamingEngine;
