# End-to-end tests

This directory verifies a real `ws` transport path across the workspace packages: protocol frames, server routing/streaming, and client consumption. Package unit tests live beside their packages.

## Tracked contents

- `bxios.e2e.test.ts` — starts a local WebSocket server and checks unary routing plus multiplexed streaming through the built workspace packages.

## Navigation

Run `pnpm exec vitest run e2e/bxios.e2e.test.ts` from the repository root. The root [`README.md`](../README.md) explains the complete low-level unary pattern; see [`packages/wire/README.md`](../packages/wire/README.md), [`packages/bxios/README.md`](../packages/bxios/README.md), and [`packages/server/README.md`](../packages/server/README.md) for the participating packages.
