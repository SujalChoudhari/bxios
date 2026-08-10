import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  ConnectionManager,
  MultiplexedStreamingClient,
} from '@bxios/bxios';
import {
  createStreamStartFrame,
  decodeFrame,
  decodeStreamValue,
  encodeFrame,
  encodeStreamValue,
  FrameType,
} from '@bxios/wire';
import { Controller, Get, RouteRegistry, WSServerDriver, MultiplexedStreamingEngine } from '@bxios/server';

const waitFor = async (predicate: () => boolean, timeout = 2_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for E2E condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('bxios real transport E2E', () => {
  let driver: WSServerDriver | undefined;
  let connection: ConnectionManager | undefined;

  afterEach(async () => {
    connection?.disconnect();
    await driver?.close();
    connection = undefined;
    driver = undefined;
  });

  it('serves unary REST-shaped requests over authenticated MessagePack frames', async () => {
    @Controller('/api')
    class ApiController {
      @Get('/greeting')
      greeting(request: { query?: Record<string, string> }) {
        return { greeting: `hello ${request.query?.name ?? 'world'}` };
      }
    }
    const router = new RouteRegistry();
    router.registerController(ApiController);
    driver = new WSServerDriver({ auth: { protocolPrefix: 'auth.', validate: (token) => token === 'e2e-token' } });
    await driver.listen(0, '127.0.0.1');

    const responses = new Map<string, ReturnType<typeof decodeFrame>>();
    driver.onMessage = async (id, data) => {
      const frame = decodeFrame(data);
      if (frame.type !== FrameType.Unary) return;
      const request = decodeStreamValue<{ method: string; url: string }>(frame.data);
      const result = await router.handle({ ...request, path: request.url, id });
      driver!.send(id, encodeFrame({
        type: FrameType.Unary,
        id: frame.id,
        data: encodeStreamValue(result),
        code: 200,
      }));
    };
    connection = new ConnectionManager({
      url: `ws://127.0.0.1:${driver.port}`,
      protocols: ['auth.e2e-token'],
      webSocketImpl: WebSocket,
      autoReconnect: false,
    });
    connection.onMessage = (data) => responses.set(decodeFrame(data).id, decodeFrame(data));
    connection.connect();
    await waitFor(() => connection!.getStatus() === 'CONNECTED');
    const id = 'unary-e2e';
    connection.send(encodeFrame({ type: FrameType.Unary, id, data: encodeStreamValue({ method: 'GET', url: '/api/greeting?name=bxios' }) }));
    await waitFor(() => responses.has(id));
    expect(decodeStreamValue(responses.get(id)!.data)).toEqual({ greeting: 'hello bxios' });
  });

  it('streams chunks, observes backpressure, and reconnects after a dropped socket', async () => {
    driver = new WSServerDriver();
    await driver.listen(0, '127.0.0.1');
    const engine = new MultiplexedStreamingEngine(driver, {
      backpressureHighWaterMark: 0,
      backpressurePollIntervalMs: 2,
      backpressureTimeoutMs: 1_000,
      handler: async (request) => (async function* () {
        yield `${request.path}:one`;
        yield `${request.path}:two`;
        yield `${request.path}:three`;
      })(),
    });
    connection = new ConnectionManager({
      url: `ws://127.0.0.1:${driver.port}`,
      webSocketImpl: WebSocket,
      autoReconnect: true,
      minReconnectDelay: 10,
      maxReconnectDelay: 20,
    });
    const client = new MultiplexedStreamingClient(connection);
    connection.connect();
    await waitFor(() => connection!.getStatus() === 'CONNECTED');
    const values: string[] = [];
    for await (const value of client.stream<string>({ path: '/stream' }) as any) values.push(value);
    expect(values).toEqual(['/stream:one', '/stream:two', '/stream:three']);

    connection.getSocket().close();
    await waitFor(() => connection!.getStatus() === 'RECONNECTING');
    await waitFor(() => connection!.getStatus() === 'CONNECTED');
    expect(connection.getReconnectAttempt()).toBe(0);
    expect(engine).toBeDefined();
  });
});
