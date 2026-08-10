# README documentation design

The README mirrors the actual package entrypoints and the verified E2E/example workflow. It describes the current workspace state without implying an npm release.

## High-level information flow

```mermaid
flowchart LR
  Developer[Developer checkout] --> Workspace[pnpm workspace]
  Workspace --> Wire[@bxios/wire]
  Workspace --> Client[@bxios/bxios]
  Workspace --> Server[@bxios/server]
  Client <--> Transport[WebSocket transport]
  Transport <--> Server
```

## Low-level protocol flow

```mermaid
flowchart TD
  Request[Request or StreamStart] --> Encode[encodeFrame + MessagePack]
  Encode --> Socket[Binary WebSocket message]
  Socket --> Decode[decodeFrame]
  Decode --> Unary[Unary route handler]
  Decode --> Stream[Streaming engine]
  Stream --> Gate[High-water mark gate]
  Gate --> Chunk[StreamChunk]
  Chunk --> Finish[StreamEnd or StreamCancel]
```

## Class/interface design

```mermaid
classDiagram
  class IDriver { +listen() +send(data) +close() +getBufferedAmount() }
  class ConnectionManager
  class WSServerDriver
  class UWSServerDriver
  class RouteRegistry
  class MultiplexedStreamingClient
  class MultiplexedStreamingEngine
  IDriver <|.. ConnectionManager
  IDriver <|.. WSServerDriver
  IDriver <|.. UWSServerDriver
  MultiplexedStreamingClient --> IDriver
  MultiplexedStreamingEngine --> IDriver
  RouteRegistry --> MultiplexedStreamingEngine
```

## Quick-start sequence

```mermaid
sequenceDiagram
  participant D as Developer
  participant C as Client
  participant S as Server
  D->>S: WSServerDriver.listen()
  D->>C: ConnectionManager.connect()
  C->>S: binary MessagePack frame
  S->>S: decode and route
  S-->>C: Unary response or stream frames
  C-->>D: Promise or ReadableStream values
```
