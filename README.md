# bxios

bxios is a TypeScript monorepo for REST-shaped requests and multiplexed streaming over binary MessagePack WebSocket frames. It includes a browser-friendly client connection manager, a Node.js server driver, routing/decorator helpers, authentication, and streaming backpressure controls.

The packages are currently workspace artifacts. They are buildable with ESM, CommonJS, and `.d.ts` output, but they have not been published to npm yet.

## Packages and installation

The supported development install is from a checkout:

```sh
git clone https://github.com/SujalChoudhari/bxios.git
cd bxios
pnpm install
pnpm build
```

The workspace packages are `@bxios/wire`, `@bxios/bxios`, and `@bxios/server`. A small React example lives in `examples/react-bxios` and is included in the workspace build. Do not use npm publication commands as part of development; no registry release is promised by this repository.

## Quick start: server

This starts the real `ws` transport on an ephemeral local port and sends three values through the streaming engine:

```ts
import { MultiplexedStreamingEngine, WSServerDriver } from '@bxios/server';

const driver = new WSServerDriver();
await driver.listen(0, '127.0.0.1');
new MultiplexedStreamingEngine(driver, {
  handler: async () => (async function* () {
    yield 'connected';
    yield 'ready';
  })(),
});

console.log(`WebSocket server listening on ws://127.0.0.1:${driver.port}`);
```

`createServerDriver('auto')` selects `UWSServerDriver` when the optional native `uWebSockets.js` binding is available and otherwise uses `WSServerDriver`. Passing `'ws'` always selects the Node.js `ws` driver.

## Quick start: client

The client accepts a native WebSocket implementation or an injected compatible implementation such as `ws` in Node.js:

```ts
import { ConnectionManager, MultiplexedStreamingClient } from '@bxios/bxios';

const connection = new ConnectionManager({
  url: 'ws://127.0.0.1:3000',
  autoReconnect: true,
});
const streaming = new MultiplexedStreamingClient(connection);
connection.connect();

for await (const value of streaming.stream<string>({ method: 'GET', path: '/events' }) as any) {
  console.log(value);
}
```

In Node.js, provide `webSocketImpl: WebSocket` from the `ws` package in the `ConnectionManager` options. The manager enforces binary mode, emits reconnect attempts, and supports configurable exponential backoff and ping/pong heartbeat timers.

## Routing and unary frames

`@bxios/server` provides `Controller`, `Get`, `Post`, `Body`, `Query`, `Param`, `Headers`, and `Context` decorators plus `RouteRegistry`. Register a controller and call `router.handle(request)` from your frame handler:

```ts
import { Controller, Get, Query, RouteRegistry } from '@bxios/server';

@Controller('/api')
class GreetingController {
  @Get('/greeting')
  greeting(@Query('name') name: string) {
    return { greeting: `hello ${name ?? 'world'}` };
  }
}

const router = new RouteRegistry();
router.registerController(GreetingController);
```

There is no hidden high-level HTTP adapter in this release. Low-level unary handling uses `FrameType.Unary`, `encodeFrame`/`decodeFrame`, and `encodeStreamValue`/`decodeStreamValue` from `@bxios/wire`; the E2E suite contains the complete working pattern.

## Protocol

Every frame is a six-element MessagePack tuple:

```text
[type, id, streamId|null, data, metadata|null, code|null]
```

`@bxios/wire` defines these frame types: `Unary` (0), `StreamStart` (1), `StreamChunk` (2), `StreamEnd` (3), `StreamCancel` (4), and `Auth` (5). `data` is binary MessagePack data. Use the exported frame constructors for streaming and authentication rather than constructing protocol tuples by guesswork.

## Authentication and streaming notes

Configure `WSServerDriver({ auth: { validate } })` to validate a handshake token. Tokens can come from configured cookies or a WebSocket subprotocol; `protocolPrefix: 'auth.'` makes a protocol such as `auth.example-token` validate as `example-token`. Required authentication rejects an invalid upgrade. `createAuthRefreshFrame(id, token)` refreshes an existing session without closing it.

`MultiplexedStreamingEngine` accepts an async iterable, iterable, or `ReadableStream`. It sends `StreamStart`, chunks, and `StreamEnd`, handles `StreamCancel`, bounds cancellation cleanup, and waits for the driver's buffered amount to fall below `backpressureHighWaterMark` before pulling the next value.

## Runtimes and transports

- Browser-like runtimes: native WebSocket plus `ReadableStream` support.
- Node.js: `WSServerDriver` using `ws`; inject `ws`'s WebSocket constructor into `ConnectionManager`.
- Optional Node.js native transport: `UWSServerDriver` when `uWebSockets.js` is installed and loadable.
- Wire format: binary MessagePack from `@msgpack/msgpack`; text WebSocket payloads are not the protocol contract.

## React example

`examples/react-bxios/src/App.tsx` demonstrates a React component that creates a `ConnectionManager`, subscribes with `MultiplexedStreamingClient`, and renders streamed events. `examples/react-bxios/src/server.ts` starts the matching `@bxios/server` backend. Build and type-check it with:

```sh
pnpm --filter @bxios/example-react build
pnpm --filter @bxios/example-react test
```

## Local benchmark: bxios vs regular API

A reproducible loopback microbenchmark compares warmed, connection-reused bxios binary MessagePack/WebSocket unary and multiplexed streaming paths with conventional HTTP JSON and SSE baselines. On the recorded Node.js v22.23.2 Linux run (30 warm-up operations, 300 sequential samples, concurrency 1), bxios measured **0.127 ms median / 0.248 ms p95** for unary versus HTTP JSON at **1.822 ms / 2.209 ms**, and **0.508 ms / 1.048 ms** for a 10-chunk stream versus SSE at **1.727 ms / 2.148 ms**. These are local microbenchmark findings, not a universal speed claim; setup, connection reuse, deployment, payload, and concurrency can change the result.

See the [benchmark methodology, harness, results, and limitations](docs/benchmark-bxios-vs-regular-api.md), or run it with:

```sh
pnpm benchmark
```

## Development and verification

```sh
pnpm install
pnpm test
pnpm test:e2e
pnpm build
pnpm exec tsc --noEmit
git diff --check
```

`pnpm test:e2e` builds the packages first and then runs the real transport suite in `e2e/`. The root typecheck currently reports two pre-existing diagnostics in server test fixtures; package tests, E2E tests, and builds are the passing release checks.

## Contributing

Create a focused feature branch, read the relevant package source and tests, and add or update tests with behavior changes. Run the commands above before opening a pull request. Keep generated declarations/build output consistent with `pnpm build`, document protocol changes with a design note, and do not commit credentials or publish packages from local development.
