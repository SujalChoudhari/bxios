# @bxios/server

`@bxios/server` is the Node.js server layer. It provides selectable WebSocket drivers (`uWebSockets.js` when available or `ws`), handshake authentication, decorator routing with validation/error frames, and multiplexed streaming with backpressure.

## Tracked contents

- `package.json` — metadata, wire/`ws`/Zod dependencies, optional uWebSockets.js dependency, and scripts.
- `tsconfig.json` — TypeScript configuration.
- `src/` — drivers, factory, auth, routing, validation, streaming, buffer handling, types, and exports.
- `test/` — driver, router, validation, and streaming integration tests.
- `docs/` — server design notes.

## Navigation

Read [`src/README.md`](src/README.md) for modules, [`test/README.md`](test/README.md) for coverage, and [`docs/README.md`](docs/README.md) for architecture. Shared tuples live in [`../wire/README.md`](../wire/README.md); the peer client is [`../bxios/README.md`](../bxios/README.md); all three meet in [`../../e2e/README.md`](../../e2e/README.md).
