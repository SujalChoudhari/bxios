import { decodeStreamValue, createStreamChunkFrame, createStreamEndFrame, createStreamStartFrame, decodeFrame, encodeFrame, FrameType, type StreamRequest } from '@bxios/wire';
import type { IServerDriver } from './types.js';
import type { RouteRegistry, RequestContext } from './router.js';

export type StreamingHandler = (request: RequestContext, signal: AbortSignal) => AsyncIterable<unknown> | Iterable<unknown> | ReadableStream<unknown> | Promise<AsyncIterable<unknown> | Iterable<unknown> | ReadableStream<unknown>>;
export interface MultiplexedStreamingEngineOptions { router?: RouteRegistry; handler?: StreamingHandler; }

interface ActiveStream { controller: AbortController; iterator?: AsyncIterator<unknown>; }

async function toAsyncIterator(value: any): Promise<AsyncIterator<unknown>> {
  if (value?.[Symbol.asyncIterator]) return value[Symbol.asyncIterator]();
  if (value?.[Symbol.iterator]) return value[Symbol.iterator]();
  if (value?.getReader) {
    const reader = value.getReader();
    return { next: async () => { const result = await reader.read(); return result.done ? result : { done: false, value: result.value }; }, return: async () => { await reader.cancel(); return { done: true, value: undefined }; } };
  }
  throw new TypeError('Stream handler must return an AsyncIterable, Iterable, or ReadableStream');
}

export class MultiplexedStreamingEngine {
  private active = new Map<string, ActiveStream>();
  private previousOnMessage?: IServerDriver['onMessage'];
  private previousOnClose?: IServerDriver['onClose'];

  constructor(private readonly driver: IServerDriver, private readonly options: MultiplexedStreamingEngineOptions = {}) {
    this.previousOnMessage = driver.onMessage;
    this.previousOnClose = driver.onClose;
    driver.onMessage = (connectionId, data) => { this.previousOnMessage?.(connectionId, data); void this.handleMessage(connectionId, data); };
    driver.onClose = (connectionId, code, message) => { this.previousOnClose?.(connectionId, code, message); this.cancelConnection(connectionId); };
  }

  public async handleMessage(connectionId: string, data: Uint8Array): Promise<void> {
    let frame;
    try { frame = decodeFrame(data); } catch { return; }
    if (frame.type === FrameType.StreamCancel && frame.streamId !== undefined) { this.cancel(connectionId, frame.streamId); return; }
    if (frame.type !== FrameType.StreamStart || frame.streamId === undefined) return;
    const key = `${connectionId}:${frame.streamId}`;
    if (this.active.has(key)) return;
    const payload = decodeStreamValue<{ request?: StreamRequest }>(frame.data);
    const controller = new AbortController();
    const active: ActiveStream = { controller };
    this.active.set(key, active);
    this.driver.send(connectionId, encodeFrame(createStreamStartFrame(frame.id, frame.streamId, payload.request ?? {})));
    void this.run(connectionId, frame.id, frame.streamId, key, payload.request ?? {}, active);
  }

  private async run(connectionId: string, id: string, streamId: number, key: string, request: StreamRequest, active: ActiveStream): Promise<void> {
    try {
      const value = this.options.handler ? await this.options.handler(request as RequestContext, active.controller.signal) : await this.options.router?.handle({ ...request, id, frameId: id, signal: active.controller.signal } as RequestContext);
      active.iterator = await toAsyncIterator(value);
      while (!active.controller.signal.aborted) {
        const next = await Promise.race([active.iterator.next(), new Promise<IteratorResult<unknown>>(resolve => active.controller.signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), { once: true }))]);
        if (next.done || active.controller.signal.aborted) break;
        this.driver.send(connectionId, encodeFrame(createStreamChunkFrame(id, streamId, next.value)));
      }
      if (!active.controller.signal.aborted) this.driver.send(connectionId, encodeFrame(createStreamEndFrame(id, streamId)));
    } catch (error: any) {
      if (!active.controller.signal.aborted) this.driver.send(connectionId, encodeFrame(createStreamEndFrame(id, streamId, error?.statusCode ?? 500, { message: error?.message ?? 'Stream failed' })));
    } finally {
      if (active.controller.signal.aborted) await active.iterator?.return?.();
      this.active.delete(key);
    }
  }

  public cancel(connectionId: string, streamId: number): void {
    const active = this.active.get(`${connectionId}:${streamId}`);
    if (!active) return;
    active.controller.abort();
  }

  private cancelConnection(connectionId: string): void {
    for (const [key, active] of this.active) if (key.startsWith(`${connectionId}:`)) active.controller.abort();
  }
}

export const StreamingServer = MultiplexedStreamingEngine;
