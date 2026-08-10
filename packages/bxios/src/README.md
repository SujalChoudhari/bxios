# Client source

This directory implements the `@bxios/bxios` public client API. It composes `@bxios/wire` frames and driver callbacks into request/response correlation and stream consumption for browser-compatible WebSocket implementations.

## Tracked contents

- `index.ts` — public exports.
- `api.ts` — axios-like `Bxios`, request methods, cancellation, and instance factory.
- `connection.ts` — `ConnectionManager` state, reconnect, heartbeat, and driver behavior.
- `interceptors.ts` — request/response interceptor manager.
- `pendingMap.ts` — pending promise storage, timeout, rejection, and teardown.
- `streaming.ts` — `MultiplexedStreamingClient` frame handling and async stream interface.
- `types.ts` — client, request/response, interceptor, and pending-map types.

## Navigation

See [`../README.md`](../README.md) for package scope, [`../docs/README.md`](../docs/README.md) for internals, and [`../test/README.md`](../test/README.md) for assertions. This source uses [`../../wire/src/README.md`](../../wire/src/README.md) and interoperates with [`../../server/src/README.md`](../../server/src/README.md).
