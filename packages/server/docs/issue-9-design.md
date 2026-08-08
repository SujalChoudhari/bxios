# Issue #9 Design: Multiplexed Streaming Engine

The engine layers stream lifecycle handling over the existing WebSocket drivers and wire tuple codec. A client allocates a local stream ID and sends frame type 1. The server acknowledges the stream, forwards MessagePack-encoded values as frame type 2, and terminates with frame type 3. A client `ReadableStream.cancel()` sends frame type 4; the server aborts the associated `AbortController` and calls the iterator's `return()` hook.

## Class and interface diagram

```mermaid
classDiagram
    class IDriver { <<interface>> +send(data: Uint8Array): void +onMessage?: DriverOnMessage }
    class IServerDriver { <<interface>> +send(connectionId: string, data: Uint8Array): boolean +onMessage?: ServerOnMessage +onClose?: ServerOnClose }
    class MultiplexedStreamingClient { -streams: Map~number, PendingStream~ +stream(request: StreamRequest): ReadableStream +handleMessage(data: Uint8Array): void }
    class MultiplexedStreamingEngine { -active: Map~string, ActiveStream~ +handleMessage(connectionId, data): Promise~void~ +cancel(connectionId, streamId): void }
    class ActiveStream { +controller: AbortController +iterator?: AsyncIterator }
    IDriver <|.. MultiplexedStreamingClient : consumes
    IServerDriver <|.. MultiplexedStreamingEngine : consumes
    MultiplexedStreamingEngine *-- ActiveStream
    MultiplexedStreamingClient --> ReadableStream : returns
```

## Sequence diagram

```mermaid
sequenceDiagram
    participant App as Client App
    participant Client as Streaming Client
    participant WS as WebSocket Driver
    participant Server as Streaming Engine
    participant Gen as Server Generator
    App->>Client: stream(request)
    Client->>WS: frameType 1 (streamId, request)
    WS->>Server: onMessage(connectionId, bytes)
    Server->>Gen: invoke(request, AbortSignal)
    Server-->>WS: frameType 1 acknowledgement
    WS-->>Client: frameType 1
    loop each yielded value
        Gen-->>Server: value
        Server-->>Client: frameType 2 chunk
        Client->>App: ReadableStream.enqueue(value)
    end
    Server-->>Client: frameType 3 closure
    App->>Client: reader.cancel(reason)
    Client-->>Server: frameType 4 cancellation
    Server->>Gen: AbortSignal.abort(); iterator.return()
```

## High-level design

```mermaid
graph TD
    Client["MultiplexedStreamingClient"] -->|frame types 1-4| Transport["Existing IDriver / IServerDriver"]
    Transport --> Engine["MultiplexedStreamingEngine"]
    Engine --> Registry["Optional RouteRegistry"]
    Engine --> Handler["StreamingHandler(request, signal)"]
    Engine --> Active["Per-connection + streamId state"]
    Active --> Abort["AbortController and iterator.return()"]
```

## Low-level design

```mermaid
flowchart TD
    A["decodeFrame(bytes)"] --> B{"Frame type"}
    B -->|1 StreamStart| C["decode MessagePack request"]
    C --> D["Create AbortController and active key"]
    D --> E["Send type 1 acknowledgement"]
    E --> F["Iterate AsyncIterable / Iterable / ReadableStream"]
    F -->|value| G["MessagePack encode + type 2"]
    G --> F
    F -->|done| H["type 3 code 200"]
    B -->|4 StreamCancel| I["Lookup connectionId:streamId"]
    I --> J["abort signal; iterator.return()"]
    B -->|2 or 3| K["Client demultiplexer enqueue/close"]
    F -->|error| L["type 3 code >= 400 with message metadata"]
```
