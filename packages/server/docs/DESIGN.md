# @bxios/server Design & Architecture

## Overview
`@bxios/server` provides a unified, high-performance server-side WebSocket driver abstraction for the `bxios` REST-over-WebSocket library.

It supports two concrete driver implementations:
1. `UWSServerDriver` (`uwsDriver`): Native high-performance binding wrapping `uWebSockets.js`.
2. `WSServerDriver` (`wsDriver`): Pure JavaScript fallback driver wrapping the Node.js `ws` library for environments without native C++ build tools.

---

## 1. Class & Interface Diagram

```mermaid
classDiagram
    class IServerDriver {
        <<interface>>
        +kind: "uws" | "ws"
        +onConnection?: ServerOnConnection
        +onMessage?: ServerOnMessage
        +onClose?: ServerOnClose
        +onError?: ServerOnError
        +port?: number
        +host?: string
        +listen(host?, port?, handlers?): Promise~void~
        +send(connectionId: string, data: Uint8Array): boolean
        +close(connectionId?: string): Promise~void~
        +getBufferedAmount(connectionId?: string): number
    }

    class UWSServerDriver {
        +kind: "uws"
        -app: any
        -listenSocket: any
        -connections: Map~string, any~
        +listen(host?, port?, handlers?): Promise~void~
        +send(connectionId: string, data: Uint8Array): boolean
        +close(connectionId?: string): Promise~void~
        +getBufferedAmount(connectionId?: string): number
    }

    class WSServerDriver {
        +kind: "ws"
        -wss: WebSocketServer
        -connections: Map~string, WebSocket~
        +listen(host?, port?, handlers?): Promise~void~
        +send(connectionId: string, data: Uint8Array): boolean
        +close(connectionId?: string): Promise~void~
        +getBufferedAmount(connectionId?: string): number
    }

    class createServerDriver {
        +createServerDriver(kind?, options?): IServerDriver
    }

    IServerDriver <|.. UWSServerDriver : implements
    IServerDriver <|.. WSServerDriver : implements
    createServerDriver ..> IServerDriver : creates
```

---

## 2. Sequence Diagram: Message Receiving & Buffer Copy Contract

`uWebSockets.js` reuses internal `ArrayBuffer` memory allocations across incoming message callbacks. To prevent memory corruption or race conditions where downstream handlers process mutated memory asynchronously, `@bxios/server` executes a mandatory zero-offset memory copy (`buf.slice(0)` / `copyBuffer`) BEFORE passing payloads to subscriber callbacks.

```mermaid
sequenceDiagram
    autonumber
    participant Client as WS Client
    participant uWS as uWebSockets.js / Engine
    participant Driver as UWSServerDriver
    participant Helper as copyBuffer
    participant Handler as ServerOnMessage Handler

    Client->>uWS: Send WebSocket Binary Frame
    uWS->>Driver: ws.message(ws, ArrayBuffer, isBinary)
    Note over Driver,Helper: Enforce Zero-Offset Copy Contract
    Driver->>Helper: copyBuffer(ArrayBuffer)
    Helper->>Helper: buf.slice(0) / Uint8Array.from()
    Helper-->>Driver: Isolated Uint8Array Payload
    Driver->>Handler: onMessage(connectionId, copyPayload)
    Note over Handler: Safe to consume asynchronously without memory corruption
```

---

## 3. High-Level Design (HLD): Monorepo Position & Auto-Selection

```mermaid
graph TD
    subgraph Monorepo["bxios Monorepo"]
        Wire["@bxios/wire Package"]
        Server["@bxios/server Package"]
    end

    subgraph Factory["Server Driver Selection"]
        CD["createServerDriver(kind, opts)"]
        UWS_Check{"uWebSockets.js Available?"}
        UWSD["UWSServerDriver (Native C++)"]
        WSD["WSServerDriver (Node.js ws)"]
    end

    Server --> Wire
    Server --> CD
    CD -->|kind = 'uws' or 'auto'| UWS_Check
    UWS_Check -->|Yes| UWSD
    UWS_Check -->|No / Fallback| WSD
    CD -->|kind = 'ws'| WSD
```

---

## 4. Low-Level Design (LLD): Memory Copy Safeguard Flow

```mermaid
flowchart TD
    A["Incoming uWS Message Event (ws, message, isBinary)"] --> B["uWS passes reusable internal ArrayBuffer"]
    B --> C["Call copyBuffer(message)"]
    C --> D{"Buffer Type?"}
    D -->|ArrayBuffer| E["ArrayBuffer.prototype.slice(0)"]
    D -->|Uint8Array / Buffer| F["TypedArray.prototype.slice(0)"]
    E --> G["Construct new independent Uint8Array"]
    F --> G
    G --> H["Pass fresh Uint8Array to onMessage(connId, payload)"]
    H --> I["Downstream async consumers process stable memory"]
```
