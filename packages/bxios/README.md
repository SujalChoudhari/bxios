# @bxios/bxios

`@bxios/bxios` is the client-side layer: axios-shaped request APIs, interceptor and pending-request management, a reconnecting WebSocket connection manager, and multiplexed streaming.

## Tracked contents

- `package.json` — metadata, `@bxios/wire` dependency, build/test scripts.
- `tsconfig.json` — TypeScript configuration.
- `src/` — client API, connection, interception, correlation, streaming, types, and exports.
- `test/` — API, connection, and pending-map unit tests.
- `docs/` — client implementation design notes.

## Navigation

Start with [`src/README.md`](src/README.md), then use [`test/README.md`](test/README.md) for tested behavior and [`docs/README.md`](docs/README.md) for design decisions. The protocol dependency is [`../wire/README.md`](../wire/README.md); the peer server is [`../server/README.md`](../server/README.md), with integration in [`../../e2e/README.md`](../../e2e/README.md).
