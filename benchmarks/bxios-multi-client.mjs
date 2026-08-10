import { createServer, request as httpRequest, Agent as HttpAgent } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { ConnectionManager, MultiplexedStreamingClient } from '@bxios/bxios';
import { WSServerDriver, MultiplexedStreamingEngine } from '@bxios/server';
import { decodeFrame, decodeStreamValue, encodeFrame, encodeStreamValue, FrameType } from '@bxios/wire';

const CLIENT_COUNTS = [1, 10, 100];
const WARMUP = 5;
const ITERATIONS = 40;
const CHUNKS = 10;
const PAYLOAD = 'x'.repeat(256);
const REQUEST = { method: 'GET', path: '/benchmark', value: 'benchmark', payload: PAYLOAD };
const STREAM_REQUEST = { method: 'GET', path: '/benchmark-stream', value: 'benchmark', payload: PAYLOAD };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeout = 10000) => {
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
const round = (value) => Number(value.toFixed(3));
const summarize = (samples, wallMs, operations, errors) => ({
  median_ms: round(percentile(samples, 0.5)),
  p95_ms: round(percentile(samples, 0.95)),
  p99_ms: round(percentile(samples, 0.99)),
  throughput_per_s: round(operations / (wallMs / 1000)),
  errors,
  operations,
});

function httpJson(port, agent) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/benchmark', agent, headers: { accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          const parsed = JSON.parse(body);
          if (parsed.payload !== PAYLOAD) throw new Error('HTTP payload mismatch');
          resolve(parsed);
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpSse(port, agent) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/benchmark-stream', agent, headers: { accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`SSE HTTP ${res.statusCode}`));
      let buffer = '';
      let count = 0;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          if (!event.startsWith('data: ')) continue;
          const value = JSON.parse(event.slice(6));
          if (value.payload !== PAYLOAD) req.destroy(new Error('SSE payload mismatch'));
          count++;
        }
      });
      res.on('end', () => count === CHUNKS ? resolve() : reject(new Error(`SSE chunk count mismatch: ${count}`)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function makeBxiosClient(port) {
  const connection = new ConnectionManager({ url: `ws://127.0.0.1:${port}`, webSocketImpl: WebSocket, autoReconnect: false, pingInterval: 0 });
  const unaryResponses = new Map();
  connection.onMessage = (data) => {
    const frame = decodeFrame(data);
    if (frame.type === FrameType.Unary) unaryResponses.set(frame.id, decodeStreamValue(frame.data));
  };
  connection.connect();
  await waitFor(() => connection.getStatus() === 'CONNECTED');
  const streaming = new MultiplexedStreamingClient(connection);
  let requestNumber = 0;
  const unary = () => new Promise((resolve) => {
    const id = `unary-${requestNumber++}`;
    unaryResponses.set(id, undefined);
    connection.send(encodeFrame({ type: FrameType.Unary, id, data: encodeStreamValue(REQUEST) }));
    const poll = () => {
      if (unaryResponses.get(id)) { const result = unaryResponses.get(id); unaryResponses.delete(id); resolve(result); }
      else setImmediate(poll);
    };
    poll();
  });
  const stream = async () => {
    const values = [];
    for await (const value of streaming.stream(STREAM_REQUEST)) values.push(value);
    if (values.length !== CHUNKS || values.some((v, i) => v.index !== i || v.payload !== PAYLOAD)) throw new Error('bxios stream payload mismatch');
  };
  return { unary, stream, close: () => connection.disconnect() };
}

async function measure(clients, operation) {
  const samples = [];
  let errors = 0;
  const wallStart = performance.now();
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const roundStart = performance.now();
    const outcomes = await Promise.all(clients.map(async (client) => {
      const start = performance.now();
      try { await operation(client); return { latency: performance.now() - start }; }
      catch { return { latency: performance.now() - start, error: true }; }
    }));
    outcomes.forEach((outcome) => { samples.push(outcome.latency); if (outcome.error) errors++; });
    // Keep rounds synchronized without adding delay to the measured operation.
    void roundStart;
  }
  return summarize(samples, performance.now() - wallStart, clients.length * ITERATIONS, errors);
}

async function main() {
  const http = createServer((req, res) => {
    if (req.url === '/benchmark') {
      const body = JSON.stringify({ ok: true, value: 'benchmark', payload: PAYLOAD });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'keep-alive' });
      res.end(body); return;
    }
    if (req.url === '/benchmark-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (let i = 0; i < CHUNKS; i++) res.write(`data: ${JSON.stringify({ index: i, payload: PAYLOAD })}\n\n`);
      res.end(); return;
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
      wsDriver.send(connectionId, encodeFrame({ type: FrameType.Unary, id: frame.id, data: encodeStreamValue({ ok: true, value: request.value, payload: request.payload }), code: 200 }));
    }
  };
  new MultiplexedStreamingEngine(wsDriver, { handler: async () => (async function* () {
    for (let i = 0; i < CHUNKS; i++) yield { index: i, payload: PAYLOAD };
  })() });

  const results = [];
  try {
    for (const count of CLIENT_COUNTS) {
      const httpAgents = Array.from({ length: count }, () => new HttpAgent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 }));
      const bxiosClients = await Promise.all(Array.from({ length: count }, () => makeBxiosClient(wsDriver.port)));
      const httpClients = httpAgents.map((agent) => ({ unary: () => httpJson(httpPort, agent), stream: () => httpSse(httpPort, agent) }));
      for (let i = 0; i < WARMUP; i++) {
        await Promise.all(httpClients.map((client) => client.unary()));
        await Promise.all(bxiosClients.map((client) => client.unary()));
        await Promise.all(httpClients.map((client) => client.stream()));
        await Promise.all(bxiosClients.map((client) => client.stream()));
      }
      for (const [transport, clients, operation] of [
        ['regular_http_json', httpClients, (client) => client.unary()],
        ['bxios_msgpack_websocket', bxiosClients, (client) => client.unary()],
        ['regular_http_sse', httpClients, (client) => client.stream()],
        ['bxios_multiplexed_msgpack_websocket', bxiosClients, (client) => client.stream()],
      ]) results.push({ transport, clients: count, metrics: await measure(clients, operation) });
      bxiosClients.forEach((client) => client.close());
      httpAgents.forEach((agent) => agent.destroy());
    }
  } finally {
    await wsDriver.close();
    await new Promise((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, config: { client_counts: CLIENT_COUNTS, warmup: WARMUP, iterations: ITERATIONS, chunks: CHUNKS, payload_bytes: Buffer.byteLength(PAYLOAD), clock: 'performance.now() (Node monotonic clock)', synchronization: 'Promise.all per round', client_definition: 'one independently warmed persistent HTTP agent or WebSocket connection per client' }, results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
