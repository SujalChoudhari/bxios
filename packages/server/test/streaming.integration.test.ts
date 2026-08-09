import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MultiplexedStreamingClient } from '../../bxios/src/streaming.js';
import { createStreamStartFrame, decodeFrame, encodeFrame, FrameType } from '@bxios/wire';
import { MultiplexedStreamingEngine } from '../src/streaming.js';
import { WSServerDriver } from '../src/wsDriver.js';
import type { IServerDriver } from '../src/types.js';
import { Controller, Get, HttpError, RouteRegistry } from '../src/index.js';

class Loopback implements IServerDriver {
  readonly kind = 'ws' as const;
  onMessage?: IServerDriver['onMessage'];
  onClose?: IServerDriver['onClose'];
  onConnection?: IServerDriver['onConnection'];
  onError?: IServerDriver['onError'];
  private server?: MultiplexedStreamingEngine;
  sent: ReturnType<typeof decodeFrame>[] = [];

  connect(server: MultiplexedStreamingEngine) { this.server = server; }
  listen() {}
  send(data: Uint8Array): boolean;
  send(connectionId: string, data: Uint8Array): boolean;
  send(connectionIdOrData: string | Uint8Array, maybeData?: Uint8Array): boolean {
    const data = typeof connectionIdOrData === 'string' ? maybeData! : connectionIdOrData;
    this.sent.push(decodeFrame(data));
    if (typeof connectionIdOrData === 'string') (this.onMessage as any)?.(data);
    else void this.server?.handleMessage('connection', data);
    return true;
  }
  close() {}
  getBufferedAmount() { return 0; }
}

class NeverResolvingDriver implements IServerDriver {
  readonly kind = 'ws' as const;
  onMessage?: IServerDriver['onMessage'];
  onClose?: IServerDriver['onClose'];
  sent: ReturnType<typeof decodeFrame>[] = [];
  send(_connectionId: string, data: Uint8Array): boolean { this.sent.push(decodeFrame(data)); return true; }
  close() {}
  listen() {}
  getBufferedAmount() { return 0; }
}

describe('multiplexed streaming integration', () => {
  it('multiplexes independent streams and returns a client ReadableStream', async () => {
    const transport = new Loopback();
    const engine = new MultiplexedStreamingEngine(transport, {
      handler: async (request) => (async function* () {
        yield `${request.path}-1`;
        await Promise.resolve();
        yield `${request.path}-2`;
      })(),
    });
    transport.connect(engine);
    const client = new MultiplexedStreamingClient(transport as any);
    const first = client.stream<string>({ path: '/first' });
    const second = client.stream<string>({ path: '/second' });

    async function collect(stream: ReadableStream<string>) {
      const result: string[] = [];
      for await (const item of stream as any) result.push(item);
      return result;
    }

    await expect(Promise.all([collect(first), collect(second)])).resolves.toEqual([
      ['/first-1', '/first-2'], ['/second-1', '/second-2'],
    ]);
    expect(transport.sent.some(frame => frame.type === FrameType.StreamStart)).toBe(true);
    expect(transport.sent.some(frame => frame.type === FrameType.StreamChunk)).toBe(true);
    expect(transport.sent.filter(frame => frame.type === FrameType.StreamEnd)).toHaveLength(2);
  });

  it('sends frameType 4 and invokes the generator return path on cancellation', async () => {
    const transport = new Loopback();
    let finalized = false;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const engine = new MultiplexedStreamingEngine(transport, {
      handler: async () => (async function* () {
        try { yield 'before-cancel'; await wait; yield 'after-cancel'; }
        finally { finalized = true; }
      })(),
    });
    transport.connect(engine);
    const client = new MultiplexedStreamingClient(transport as any);
    const stream = client.stream<string>({ path: '/cancel' });
    const reader = stream.getReader();
    await expect(reader.read()).resolves.toEqual({ value: 'before-cancel', done: false });
    await reader.cancel('client stopped');
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(transport.sent.some(frame => frame.type === FrameType.StreamCancel)).toBe(true);
    expect(finalized).toBe(true);
  });

  it('keeps the engine wired when WSServerDriver.listen receives handlers', async () => {
    const driver = new WSServerDriver();
    const engine = new MultiplexedStreamingEngine(driver, {
      handler: async () => (async function* () { yield 'wired'; })(),
    });
    let handlerCalled = false;
    try {
      await driver.listen(0, '127.0.0.1', { onMessage: () => { handlerCalled = true; } });
      const connected = new WebSocket(`ws://127.0.0.1:${driver.port}`);
      await new Promise<void>((resolve, reject) => { connected.once('open', () => resolve()); connected.once('error', reject); });
      const frames: ReturnType<typeof decodeFrame>[] = [];
      const allFrames = new Promise<void>((resolve) => {
        connected.on('message', (data: Buffer) => {
          frames.push(decodeFrame(new Uint8Array(data)));
          if (frames.some((frame) => frame.type === FrameType.StreamEnd)) resolve();
        });
      });
      connected.send(encodeFrame(createStreamStartFrame('real-ws', 7, { path: '/wired' })));
      await allFrames;
      expect(handlerCalled).toBe(true);
      expect(frames.map((frame) => frame.type)).toEqual([FrameType.StreamStart, FrameType.StreamChunk, FrameType.StreamEnd]);
      connected.close();
    } finally {
      await driver.close();
    }
  });

  it('turns malformed stream payloads into a controlled stream error', async () => {
    const transport = new Loopback();
    const engine = new MultiplexedStreamingEngine(transport, { handler: async () => [] });
    await engine.handleMessage('connection', encodeFrame({ type: FrameType.StreamStart, id: 'bad', streamId: 9, data: new Uint8Array([0xc1]) }));
    expect(transport.sent.at(-1)).toMatchObject({ type: FrameType.StreamEnd, streamId: 9, code: 400 });
  });

  it('preserves router error status and metadata in the stream end frame', async () => {
    @Controller('/router')
    class RouterController {
      @Get('/error')
      error() { throw new HttpError(429, 'Too many requests'); }
    }
    const router = new RouteRegistry();
    router.registerController(RouterController);
    const transport = new Loopback();
    const engine = new MultiplexedStreamingEngine(transport, { router });

    await engine.handleMessage('connection', encodeFrame(createStreamStartFrame('router-error', 12, {
      path: '/router/error',
      headers: { 'x-request': 'router' },
    })));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(transport.sent.map(frame => frame.type)).toEqual([FrameType.StreamStart, FrameType.StreamEnd]);
    expect(transport.sent.at(-1)).toMatchObject({
      type: FrameType.StreamEnd,
      streamId: 12,
      code: 429,
      metadata: { 'x-request': 'router' },
    });
  });

  it('ends an acknowledged stream when no handler or router is configured', async () => {
    const transport = new Loopback();
    const engine = new MultiplexedStreamingEngine(transport);

    await engine.handleMessage('connection', encodeFrame(createStreamStartFrame('no-engine', 13, {})));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(transport.sent.map(frame => frame.type)).toEqual([FrameType.StreamStart, FrameType.StreamEnd]);
    expect(transport.sent.at(-1)).toMatchObject({
      type: FrameType.StreamEnd,
      streamId: 13,
      code: 500,
      metadata: { message: 'Streaming engine requires a handler or router' },
    });
  });

  it('bounds cancellation cleanup for an iterator whose next never resolves', async () => {
    const transport = new NeverResolvingDriver();
    let returned = false;
    let timedOut = false;
    const engine = new MultiplexedStreamingEngine(transport, {
      cancellationTimeoutMs: 10,
      onCancellationTimeout: () => { timedOut = true; },
      handler: async () => ({
        next: () => new Promise<IteratorResult<unknown>>(() => undefined),
        return: async () => { returned = true; return { done: true, value: undefined }; },
        [Symbol.asyncIterator]() { return this; },
      }),
    });
    await engine.handleMessage('connection', encodeFrame(createStreamStartFrame('stuck', 10, {})));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const started = Date.now();
    engine.cancel('connection', 10);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(Date.now() - started).toBeLessThan(500);
    expect(returned).toBe(true);
    expect(timedOut).toBe(false);
  });

  it('waits for the driver high-water mark before sending the next chunk', async () => {
    const transport = new Loopback() as Loopback & { buffered: number; sendTimes: number[] };
    transport.buffered = 10;
    transport.sendTimes = [];
    transport.getBufferedAmount = () => transport.buffered;
    const originalSend = transport.send.bind(transport);
    transport.send = ((connectionIdOrData: string | Uint8Array, data?: Uint8Array) => {
      transport.sendTimes.push(Date.now());
      return typeof connectionIdOrData === 'string'
        ? originalSend(connectionIdOrData, data!)
        : originalSend(connectionIdOrData);
    }) as typeof transport.send;
    const engine = new MultiplexedStreamingEngine(transport, { backpressureHighWaterMark: 0, backpressurePollIntervalMs: 2, backpressureTimeoutMs: 100 });
    const started = Date.now();
    setTimeout(() => { transport.buffered = 0; }, 15);
    await engine.handleMessage('connection', encodeFrame(createStreamStartFrame('flow', 11, {})));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(transport.sendTimes[0] - started).toBeGreaterThanOrEqual(10);
  });

  it('pauses generator execution above the default 1 MiB threshold and resumes on drain', async () => {
    const transport = new Loopback() as Loopback & { buffered: number };
    transport.buffered = 0;
    let pulls = 0;
    const engine = new MultiplexedStreamingEngine(transport, {
      backpressurePollIntervalMs: 100,
      backpressureTimeoutMs: 500,
      handler: async () => {
        transport.buffered = 1024 * 1024 + 1;
        return (async function* () {
          pulls++;
          yield 'after-drain';
        })();
      },
    });
    transport.getBufferedAmount = () => transport.buffered;

    await engine.handleMessage('connection', encodeFrame(createStreamStartFrame('drain', 14, {})));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(pulls).toBe(0);

    transport.buffered = 0;
    transport.onDrain?.('connection');
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(pulls).toBe(1);
    expect(transport.sent.at(-1)).toMatchObject({ type: FrameType.StreamEnd, streamId: 14 });
    expect(transport.sent.some(frame => frame.type === FrameType.StreamChunk && frame.streamId === 14)).toBe(true);
  });
});
