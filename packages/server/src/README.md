# Server source

This directory implements the `@bxios/server` API. It adapts WebSocket transports to a common driver interface, optionally authenticates sessions, dispatches decorated routes with Zod-aware validation, and serves buffered-output-aware multiplexed streams.

## Tracked contents

- `index.ts` — public exports.
- `types.ts` — driver types, callbacks, options, and listen-argument parsing.
- `factory.ts` — `ws`/uWebSockets.js selection.
- `wsDriver.ts` — Node.js `ws` driver.
- `uwsDriver.ts` — optional uWebSockets.js driver and availability checks.
- `buffer.ts` — safe binary payload copying.
- `auth.ts` — token extraction, session contexts, and auth refresh handling.
- `router.ts` — decorators, route registry, parameter binding, and validation integration.
- `validation.ts` — validation/HTTP errors and wire error-frame helpers.
- `streaming.ts` — `MultiplexedStreamingEngine` and backpressure-aware streaming.

## Navigation

The parent [`README.md`](../README.md) gives scope; [`../docs/README.md`](../docs/README.md) indexes architecture and [`../test/README.md`](../test/README.md) indexes checks. This source uses [`../../wire/src/README.md`](../../wire/src/README.md) and is used by the example and [`../../../e2e/README.md`](../../../e2e/README.md).
