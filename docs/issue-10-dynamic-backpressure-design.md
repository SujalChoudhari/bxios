# Issue #10: Dynamic Backpressure & Drain Control

The server streaming engine now gates iterator advancement on the per-connection transport buffer. The default high-water threshold is 1 MiB. When the buffer exceeds it, the engine does not call the generator's `next()` method; it resumes as soon as the driver emits `onDrain`, with the existing bounded polling and timeout retained as a safety fallback.

## HLD

```mermaid
graph TD
    Client[Streaming Client] --> Driver[IServerDriver]
    Driver --> Transport[WebSocket or uWebSockets Transport]
    Driver --> Engine[MultiplexedStreamingEngine]
    Engine --> Generator[Server Async Generator]
    Engine --> BufferGate[Per-connection buffer gate]
    Transport -->|getBufferedAmount| BufferGate
    Transport -->|onDrain(connectionId)| BufferGate
    BufferGate -->|writable| Generator
```

## LLD

```mermaid
flowchart TD
    A[Stream loop] --> B{getBufferedAmount > 1 MiB?}
    B -->|No| C[Call iterator.next]
    B -->|Yes| D[Register drain waiter]
    D --> E{onDrain or safety poll}
    E --> B
    C --> F[Encode and send chunk]
    F --> A
    D --> G{Timeout or abort?}
    G -->|Yes| H[End stream with controlled error or cancellation]
```

## Class and interface diagram

```mermaid
classDiagram
    class IServerDriver {
        <<interface>>
        +onDrain?: ServerOnDrain
        +getBufferedAmount(connectionId?: string) number
        +send(connectionId: string, data: Uint8Array) boolean
    }
    class ServerOnDrain {
        <<callback>>
        +call(connectionId: string) void
    }
    class MultiplexedStreamingEngine {
        -drainWaiters: Map~string, Set~Resolver~~
        +handleMessage(connectionId, data) Promise~void~
        -waitForWritable(connectionId, signal) Promise~boolean~
    }
    class WSServerDriver
    class UWSServerDriver
    IServerDriver ..> ServerOnDrain
    WSServerDriver ..|> IServerDriver
    UWSServerDriver ..|> IServerDriver
    MultiplexedStreamingEngine --> IServerDriver
```

## Sequence diagram

```mermaid
sequenceDiagram
    participant E as Streaming Engine
    participant D as Server Driver
    participant T as Transport
    participant G as Generator
    E->>D: getBufferedAmount(connectionId)
    D->>T: read buffered amount
    T-->>D: amount > 1 MiB
    D-->>E: high-water state
    Note over E,G: iterator.next() is not called
    T-->>D: drain event
    D-->>E: onDrain(connectionId)
    E->>D: getBufferedAmount(connectionId)
    D-->>E: amount <= 1 MiB
    E->>G: iterator.next()
    G-->>E: yielded value
    E->>D: send(chunk frame)
```
