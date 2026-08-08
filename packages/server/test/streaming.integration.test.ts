import { describe, expect, it } from 'vitest';
import { MultiplexedStreamingClient } from '../../bxios/src/streaming.js';
import { decodeFrame, FrameType } from '@bxios/wire';
import { MultiplexedStreamingEngine } from '../src/streaming.js';
import type { IServerDriver } from '../src/types.js';

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
    if (typeof connectionIdOrData === 'string') this.onMessage?.(data);
    else void this.server?.handleMessage('connection', data);
    return true;
  }
  close() {}
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
});
