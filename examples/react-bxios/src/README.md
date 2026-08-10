# React example source

This directory contains the consumer component and small server that demonstrate streamed bxios values in React. It remains outside library packages so it can show usage without becoming product code.

## Tracked contents

- `App.tsx` — React component using `ConnectionManager` and `MultiplexedStreamingClient` to render received events.
- `server.ts` — local `WSServerDriver` and `MultiplexedStreamingEngine` setup that supplies example values.

## Navigation

The parent [`README.md`](../README.md) covers workspace commands. Compare the component with [`packages/bxios/src/README.md`](../../../packages/bxios/src/README.md) and the backend with [`packages/server/src/README.md`](../../../packages/server/src/README.md). For an executable transport test, see [`e2e/bxios.e2e.test.ts`](../../../e2e/bxios.e2e.test.ts).
