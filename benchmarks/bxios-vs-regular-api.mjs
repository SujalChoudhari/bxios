import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { ConnectionManager, MultiplexedStreamingClient } from '@bxios/bxios';
import { WSServerDriver, MultiplexedStreamingEngine } from '@bxios/server';
import { decodeFrame, decodeStreamValue, encodeFrame, encodeStreamValue, FrameType } from '@bxios/wire';

const WARMUP = 30;
const ITERATIONS = 300;
const CHUNKS = 10;
const PAYLOAD = 'x'.repeat(256);
const REQUEST = { method: 'GET', path: '/benchmark', value: 'benchmark', payload: PAYLOAD };
const STREAM_REQUEST = { method: 'GET', path: '/benchmark-stream', value: 'benchmark', payload: PAYLOAD };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for benchmark setup');
    await sleep(2);
  }
};
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const summarize = (samples) => {
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    median_ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(3)),
    mean_ms: Number((total / samples.length).toFixed(3)),
    throughput_per_s: Number((samples.length / (total / 1000)).toFixed(2)),
  };
};
const requestJson = (port) => new Promise((resolve, reject) => {
  fetch(`http://127.0.0.1:${port}/benchmark`, { headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.payload !== PAYLOAD) throw new Error('HTTP payload mismatch');
      resolve(body);
    })
    .catch(reject);
});

async function main() {
  const http = createServer(async (req, res) => {
    if (req.url === '/benchmark') {
      const body = JSON.stringify({ ok: true, value: 'benchmark', payload: PAYLOAD });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.url === '/benchmark-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (let i = 0; i < CHUNKS; i++) res.write(`data: ${JSON.stringify({ index: i, payload: PAYLOAD })}\n\n`);
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const httpPort = http.address().port;

  const wsDriver = new WSServerDriver();
  await wsDriver.listen(0, '127.0.0.1');
  wsDriver.onMessage = async (connectionId, data) => {
    const frame = decodeFrame(data);
    if (frame.type === FrameType.Unary) {
      const request = decodeStreamValue(frame.data);
      const result = { ok: true, value: request.value, payload: request.payload };
      wsDriver.send(connectionId, encodeFrame({ type: FrameType.Unary, id: frame.id, data: encodeStreamValue(result), code: 200 }));
    }
  };
  new MultiplexedStreamingEngine(wsDriver, {
    handler: async () => (async function* () {
      for (let i = 0; i < CHUNKS; i++) yield { index: i, payload: PAYLOAD };
    })(),
  });

  const connection = new ConnectionManager({ url: `ws://127.0.0.1:${wsDriver.port}`, webSocketImpl: WebSocket, autoReconnect: false, pingInterval: 0 });
  connection.connect();
  await waitFor(() => connection.getStatus() === 'CONNECTED');
  const unaryResponses = new Map();
  connection.onMessage = (data) => {
    const frame = decodeFrame(data);
    if (frame.type === FrameType.Unary) unaryResponses.set(frame.id, decodeStreamValue(frame.data));
    };
    const streamClient = new MultiplexedStreamingClient(connection);
  let requestNumber = 0;
  const bxiosUnary = () => new Promise((resolve) => {
    const id = `unary-${requestNumber++}`;
    unaryResponses.set(id, undefined);
    connection.send(encodeFrame({ type: FrameType.Unary, id, data: encodeStreamValue(REQUEST) }));
    const poll = () => {
      if (unaryResponses.get(id)) { const result = unaryResponses.get(id); unaryResponses.delete(id); resolve(result); }
      else setImmediate(poll);
    };
    poll();
  });
  const bxiosStream = async () => {
    const values = [];
    for await (const value of streamClient.stream(STREAM_REQUEST)) values.push(value);
    if (values.length !== CHUNKS || values.some((v, i) => v.index !== i || v.payload !== PAYLOAD)) throw new Error('bxios stream payload mismatch');
  };
  const sseStream = async () => {
    const response = await fetch(`http://127.0.0.1:${httpPort}/benchmark-stream`);
    if (!response.ok || !response.body) throw new Error('SSE request failed');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let count = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        if (event.startsWith('data: ')) {
          const parsed = JSON.parse(event.slice(6));
          if (parsed.payload !== PAYLOAD) throw new Error('SSE payload mismatch');
          count++;
        }
      }

    }
    if (count !== CHUNKS) throw new Error(`SSE chunk count mismatch: ${count}`);
  };

  for (let i = 0; i < WARMUP; i++) { await requestJson(httpPort); await bxiosUnary(); await sseStream(); await bxiosStream(); }
  const measure = async (fn) => { const samples = []; for (let i = 0; i < ITERATIONS; i++) { const start = performance.now(); await fn(); samples.push(performance.now() - start); } return summarize(samples); };
  const results = {
    config: { warmup: WARMUP, iterations: ITERATIONS, concurrency: 1, chunks: CHUNKS, payload_bytes: Buffer.byteLength(PAYLOAD), clock: 'performance.now() (Node monotonic clock)', server_work: 'fixed response / fixed 10 generated chunks, loopback only' },
    sizes: { http_json_response_bytes: Buffer.byteLength(JSON.stringify({ ok: true, value: 'benchmark', payload: PAYLOAD })), bxios_unary_frame_bytes: encodeFrame({ type: FrameType.Unary, id: 'unary-size', data: encodeStreamValue(REQUEST) }).byteLength, http_sse_event_bytes: Buffer.byteLength(`data: ${JSON.stringify({ index: 0, payload: PAYLOAD })}\n\n`), bxios_stream_chunk_frame_bytes: encodeFrame({ type: FrameType.StreamChunk, id: 'stream-size', streamId: 1, data: encodeStreamValue({ index: 0, payload: PAYLOAD }) }).byteLength },
    unary: { regular_http_json: await measure(() => requestJson(httpPort)), bxios_msgpack_websocket: await measure(bxiosUnary) },
    streaming: { regular_http_sse: await measure(sseStream), bxios_multiplexed_msgpack_websocket: await measure(bxiosStream) },
  };
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, ...results }, null, 2));
  connection.disconnect();
  await wsDriver.close();
  await new Promise((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
