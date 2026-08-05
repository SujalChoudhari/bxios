# ConnectionManager Design Document

## Overview
`ConnectionManager` provides isomorphic WebSocket socket lifecycle management across Browser and Node environments for `@bxios/bxios`. It implements the `IDriver` interface from `@bxios/wire` and provides automatic exponential backoff reconnection and a 30-second ping/pong heartbeat timer.

---

## 1. Class & Interface Diagram

```mermaid
classDiagram
    class IDriver {
        <<interface>>
        +onMessage?: DriverOnMessage
        +onConnect?: DriverOnConnect
        +onClose?: DriverOnClose
        +onDrain?: DriverOnDrain
        +listen(options?: any): void
        +send(data: Uint8Array): void
        +close(): void
        +getBufferedAmount(): number
    }

    class ConnectionState {
        <<enumeration>>
        DISCONNECTED
        CONNECTING
        CONNECTED
        RECONNECTING
    }

    class ConnectionManagerOptions {
        <<interface>>
        +string url
        +any webSocketImpl
        +string protocols
        +boolean autoReconnect
        +number minReconnectDelay
        +number maxReconnectDelay
        +number reconnectFactor
        +number pingInterval
        +number pingTimeout
        +Uint8Array pingPayload
    }

    class ConnectionManager {
        -any socket
        -string url
        -ConnectionManagerOptions options
        -ConnectionState state
        -number reconnectAttempt
        -Timeout reconnectTimer
        -Interval heartbeatTimer
        -Timeout pongTimeoutTimer
        -boolean isManualClose
        +getStatus(): ConnectionState
        +getSocket(): any
        +getReconnectAttempt(): number
        +listen(options?: any): void
        +connect(url?: string): void
        +send(data: Uint8Array): void
        +disconnect(): void
        +close(): void
        +getBufferedAmount(): number
        +calculateReconnectDelay(attempt: number): number
        +startHeartbeat(): void
        +stopHeartbeat(): void
        +sendPing(): void
        +handlePong(): void
    }

    ConnectionManager ..|> IDriver : implements
    ConnectionManager *-- ConnectionState : tracks
    ConnectionManager ..> ConnectionManagerOptions : configured by
```

---

## 2. Sequence Diagram: Lifecycle, Heartbeat & Reconnection

```mermaid
sequenceDiagram
    autonumber
    actor Client as Bxios Client
    participant CM as ConnectionManager
    participant WS as Native WebSocket
    participant Heartbeat as Heartbeat Timer

    rect rgb(235, 245, 255)
        note over Client, WS: 1. Connection & binaryType Enforcement
        Client->>CM: connect("ws://host")
        CM->>WS: new WebSocket("ws://host")
        CM->>WS: socket.binaryType = 'arraybuffer'
        WS-->>CM: onopen()
        CM->>CM: status = CONNECTED, reconnectAttempt = 0
        CM->>Heartbeat: startHeartbeat() (30s interval)
        CM-->>Client: onConnect()
    end

    rect rgb(240, 255, 240)
        note over CM, WS: 2. 30s Heartbeat Ping/Pong
        Heartbeat-->>CM: 30s Ping Timer Fires
        CM->>WS: sendPing() (0x9 byte or socket.ping())
        WS-->>CM: onmessage("pong")
        CM->>CM: handlePong()
    end

    rect rgb(255, 240, 240)
        note over Client, WS: 3. Unexpected Close & Exponential Backoff
        WS-->>CM: onclose(wasClean=false)
        CM->>Heartbeat: stopHeartbeat()
        CM->>CM: status = RECONNECTING, calc delay min(1s*2^n, 30s)
        CM->>CM: setTimeout(connect, delay)
        CM-->>Client: onReconnectAttempt(attempt, delay)
    end
```

---

## 3. High-Level Design (HLD): Monorepo Transport Position

```mermaid
graph TD
    subgraph Monorepo["bxios Monorepo"]
        WirePkg["@bxios/wire Package (IDriver Interface)"]
        BxiosPkg["@bxios/bxios Package"]
    end

    subgraph ClientApp["Application Layer"]
        App["Browser / Node Client Application"]
    end

    subgraph ConnMgr["ConnectionManager Transport Layer"]
        Manager["ConnectionManager (IDriver)"]
        BinaryEnforcer["binaryType = 'arraybuffer' Enforcer"]
        BackoffEngine["Exponential Backoff Engine (1s -> 30s)"]
        HeartbeatEngine["30s Heartbeat Ping/Pong Timer"]
    end

    subgraph NativeWS["Socket Implementation"]
        WSInstance["Native WebSocket Instance"]
    end

    App -->|listen / connect| Manager
    Manager --> WirePkg
    Manager --> BinaryEnforcer
    Manager --> BackoffEngine
    Manager --> HeartbeatEngine
    BinaryEnforcer -->|Instantiate & Set binaryType| WSInstance
    BackoffEngine -.->|Schedule Reconnect| Manager
    HeartbeatEngine -.->|Send Ping Frames| WSInstance
```

---

## 4. Low-Level Design (LLD): Flowchart & State Machine

```mermaid
flowchart TD
    Start["ConnectionManager.connect(url)"] --> Setup["Instantiate WebSocket(url)"]
    Setup --> ArrayBuffer["Enforce socket.binaryType = 'arraybuffer'"]
    ArrayBuffer --> EventListeners["Attach onopen, onmessage, onerror, onclose"]
    
    EventListeners --> OnOpen{"onopen Event?"}
    OnOpen -->|Fires| Connected["state = CONNECTED<br/>reconnectAttempt = 0"]
    Connected --> StartHeartbeat["startHeartbeat(): 30s Timer"]
    
    StartHeartbeat --> HeartbeatLoop{"30s Interval Timer"}
    HeartbeatLoop -->|Fires| SendPing["sendPing(): Send payload / socket.ping()"]
    SendPing --> PongTimeout{"Pong Received within Timeout?"}
    PongTimeout -->|Yes| ResetPong["handlePong(): Reset timer"]
    PongTimeout -->|No| ForceClose["socket.close(): Reset socket"]

    EventListeners --> OnClose{"onclose Event?"}
    OnClose -->|Fires| StopHB["stopHeartbeat()"]
    StopHB --> ManualCheck{"isManualClose == true?"}
    ManualCheck -->|Yes| Disconnected["state = DISCONNECTED"]
    ManualCheck -->|No| CalcDelay["delay = min(minDelay * 2^attempt, 30000ms)"]
    CalcDelay --> IncAttempt["reconnectAttempt++<br/>state = RECONNECTING"]
    IncAttempt --> ScheduleTimer["setTimeout(connect, delay)"]
    ScheduleTimer -.->|Timer Fires| Start
```
