# Issue #2: Universal IDriver Abstraction Layer Design Document

## Overview

The `@bxios/wire` package defines the core wire-protocol structures and transport abstractions used across `bxios`. Issue #2 establishes the `IDriver` interface and its associated callback types (`DriverOnMessage`, `DriverOnConnect`, `DriverOnClose`, `DriverOnDrain`), serving as the transport-agnostic interface layer for framed binary communication over various underlying networks (WebSockets, TCP sockets, in-memory channels, etc.).

---

## 1. High-Level Design (HLD)

The `IDriver` interface decouples higher-level protocol components (such as frame serialization via `FrameType`/`FrameTuple` and session management) from platform-specific network transports. Concrete transport implementations (e.g., WebSocket or TCP drivers in Issue #3) implement `IDriver` to provide transport operations.

```mermaid
graph TD
    subgraph Bxios Client/Server Application Layer
        Client["bxios Client / Server Session Manager"]
    end

    subgraph Package @bxios/wire
        Codec["Frame Codec<br/>(encodeFrame / decodeFrame)"]
        IDriver["IDriver Abstraction Interface<br/>(listen, send, close, getBufferedAmount)"]
        Types["Wire Types<br/>(FrameType, FrameTuple)"]
    end

    subgraph Future Transport Drivers (Issue #3)
        WsDriver["WebSocketDriver / BunWsDriver<br/>(implements IDriver)"]
        TcpDriver["TcpDriver / NodeNetDriver<br/>(implements IDriver)"]
        MemoryDriver["InMemoryDriver / LoopbackDriver<br/>(implements IDriver)"]
    end

    subgraph Native Transport Connections
        WS["WebSocket Server / Client Socket"]
        TCP["Node.js net.Socket / Server"]
        Channel["In-Memory MessageChannel / Queue"]
    end

    Client --> Codec
    Client --> IDriver
    IDriver <|.. WsDriver
    IDriver <|.. TcpDriver
    IDriver <|.. MemoryDriver

    WsDriver --> WS
    TcpDriver --> TCP
    MemoryDriver --> Channel
```

---

## 2. Low-Level Design (LLD)

The `IDriver` surface consists of four core methods (`listen`, `send`, `close`, `getBufferedAmount`) and four optional event callbacks (`onMessage`, `onConnect`, `onClose`, `onDrain`). The LLD diagram illustrates how callers invoke methods on an `IDriver` instance and how event callbacks bridge low-level network events back to the caller.

```mermaid
flowchart LR
    subgraph Application Caller / Protocol Engine
        Caller["Protocol Engine / Frame Handler"]
    end

    subgraph IDriver Abstraction Instance
        subgraph Methods Surface
            Listen["listen(options?: any)"]
            Send["send(data: Uint8Array)"]
            Close["close()"]
            GetBuf["getBufferedAmount(): number"]
        end

        subgraph Callback Handlers Surface
            OnConnect["onConnect?: DriverOnConnect"]
            OnMessage["onMessage?: DriverOnMessage"]
            OnClose["onClose?: DriverOnClose"]
            OnDrain["onDrain?: DriverOnDrain"]
        end
    end

    subgraph Native Transport Engine
        NetConn["Underlying Transport Socket / Stream"]
    end

    Caller -- "1. Invoke listen(options)" --> Listen
    Listen -- "Initializes & Connects" --> NetConn
    NetConn -- "Transport Open Event" --> OnConnect
    OnConnect -- "Notify Connected ()" --> Caller

    Caller -- "2. Invoke send(bytes)" --> Send
    Send -- "Write Raw Bytes" --> NetConn
    NetConn -- "Received Bytes Event" --> OnMessage
    OnMessage -- "Deliver Raw Bytes (data)" --> Caller

    NetConn -- "Socket Drain Event" --> OnDrain
    OnDrain -- "Notify Buffer Cleared ()" --> Caller

    Caller -- "3. Invoke close()" --> Close
    Close -- "Terminate Connection" --> NetConn
    NetConn -- "Transport Closed Event" --> OnClose
    OnClose -- "Notify Closed (hadError?)" --> Caller

    Caller -- "Poll Buffer Level" --> GetBuf
    GetBuf -- "Query Backpressure" --> NetConn
```

---

## 3. Class / Interface Diagram

This diagram displays the exact TypeScript interfaces and callback types defined in `packages/wire/src/driver.ts`.

```mermaid
classDiagram
    class DriverOnMessage {
        <<typedef>>
        +call(data: Uint8Array) void
    }
    class DriverOnConnect {
        <<typedef>>
        +call() void
    }
    class DriverOnClose {
        <<typedef>>
        +call(hadError?: boolean) void
    }
    class DriverOnDrain {
        <<typedef>>
        +call() void
    }

    class IDriver {
        <<interface>>
        +onMessage?: DriverOnMessage
        +onConnect?: DriverOnConnect
        +onClose?: DriverOnClose
        +onDrain?: DriverOnDrain
        +listen(options?: any) void
        +send(data: Uint8Array) void
        +close() void
        +getBufferedAmount() number
    }

    IDriver ..> DriverOnMessage : uses
    IDriver ..> DriverOnConnect : uses
    IDriver ..> DriverOnClose : uses
    IDriver ..> DriverOnDrain : uses
```

---

## 4. Sequence Diagram

The sequence diagram documents end-to-end send and receive workflows, connection lifecycle, and backpressure management using `getBufferedAmount()` and `onDrain()`.

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Caller / Protocol Engine
    participant Driver as IDriver Instance
    participant Transport as Native Transport / Socket
    actor Peer as Remote Peer Endpoint

    Note over Caller, Peer: Phase 1: Connection & Listen Setup
    Caller->>Driver: listen(options)
    Driver->>Transport: Bind / Connect socket
    Transport-->>Peer: Establish connection
    Transport-->>Driver: Transport Open Event
    Driver-->>Caller: onConnect() callback

    Note over Caller, Peer: Phase 2: Send & Receive Roundtrip
    Caller->>Driver: send(payloadBytes)
    Driver->>Transport: write(payloadBytes)
    Transport-->>Peer: Network Packet Transmission
    Peer-->>Transport: Peer Bytes Received
    Transport-->>Driver: Raw Data Event
    Driver-->>Caller: onMessage(dataBytes)

    Note over Caller, Peer: Phase 3: Backpressure Handling & Drain
    Caller->>Driver: send(largeBuffer)
    Driver->>Transport: write(largeBuffer)
    Caller->>Driver: getBufferedAmount()
    Driver-->>Caller: returns high buffered amount (e.g. > threshold)
    Note over Caller: Caller pauses sending further frames
    Transport-->>Driver: Buffer Flushed / Socket Drain Event
    Driver-->>Caller: onDrain() callback
    Note over Caller: Caller resumes sending frames

    Note over Caller, Peer: Phase 4: Connection Termination
    Caller->>Driver: close()
    Driver->>Transport: close socket
    Transport-->>Driver: Transport Closed Event
    Driver-->>Caller: onClose(hadError=false) callback
```
