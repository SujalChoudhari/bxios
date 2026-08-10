# E2E and release-readiness design

The E2E suite uses the public package entrypoints against an ephemeral `ws` server. Unary requests use the same six-field MessagePack frame contract as streaming requests; the example is a small React client paired with a real `@bxios/server` driver.

## High-level design

```mermaid
flowchart LR
  React[React example] --> Client[ConnectionManager + StreamingClient]
  Client --> Wire[MessagePack frames]
  Wire --> Driver[WSServerDriver]
  Driver --> Router[RouteRegistry / StreamingEngine]
```

## Low-level design

```mermaid
flowchart TD
  Start[StreamStart] --> Decode[decodeFrame]
  Decode --> Dispatch[StreamingEngine.handleMessage]
  Dispatch --> Watermark{buffered > high water mark?}
  Watermark -- yes --> Drain[wait for drain or poll]
  Drain --> Watermark
  Watermark -- no --> Chunk[StreamChunk]
  Chunk --> End[StreamEnd]
```

## Class and interface relationships

```mermaid
classDiagram
  class IDriver { +send(data) +onMessage +getBufferedAmount() }
  class ConnectionManager
  class WSServerDriver
  class MultiplexedStreamingClient
  class MultiplexedStreamingEngine
  IDriver <|.. ConnectionManager
  IDriver <|.. WSServerDriver
  MultiplexedStreamingClient --> IDriver
  MultiplexedStreamingEngine --> IDriver
```

## Request sequence

```mermaid
sequenceDiagram
  participant R as React
  participant C as Client
  participant S as Server
  R->>C: stream({ path: "/events" })
  C->>S: StreamStart
  S-->>C: StreamStart, StreamChunk*
  S-->>C: StreamEnd
  C-->>R: ReadableStream values
  S-->>C: socket close
  C->>S: reconnect after backoff
```

The suite is intentionally transport-level: it does not claim an unimplemented high-level REST adapter. `pnpm build` emits ESM, CommonJS, and declaration files for all publishable `@bxios/*` packages.
