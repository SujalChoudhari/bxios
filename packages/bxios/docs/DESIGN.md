# @bxios/bxios PendingMap Correlation Engine Design

## Overview
`@bxios/bxios` provides the core correlation state machine for mapping asynchronous WebSocket responses back to their original caller Promises via `PendingMap`.

---

## 1. Class & Interface Diagram

```mermaid
classDiagram
    class PendingRequest~T~ {
        +string id
        +resolve(value: T): void
        +reject(reason: any): void
        +timer?: Timeout
        +timeout?: number
        +config?: Record~string, any~
        +createdAt?: number
    }

    class AxiosLikeError {
        <<interface>>
        +string code
        +string message
        +boolean isAxiosError
        +number statusCode
        +Record~string, any~ config
    }

    class PendingMapOptions {
        <<interface>>
        +number defaultTimeout
    }

    class PendingMap {
        -Map~string, PendingRequest~ map
        -number defaultTimeout
        +constructor(options?: PendingMapOptions | number)
        +add(id: string, pending: Omit~PendingRequest, 'id'~, timeoutMs?: number): void
        +resolve(id: string, value: any): void
        +reject(id: string, reason: any): void
        +get(id: string): PendingRequest | undefined
        +has(id: string): boolean
        +setTimeout(ms: number): void
        +getTimeout(): number
        +clear(reason?: any): void
        +teardown(reason?: any): void
        +size: number
    }

    PendingMap "1" *-- "*" PendingRequest : manages
    PendingMap ..> AxiosLikeError : creates on timeout
    PendingMap ..> PendingMapOptions : configured by
```

---

## 2. Sequence Diagram: Request Lifecycle & Timeout Handling

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Client Request Caller
    participant PM as PendingMap
    participant Timer as NodeJS Timeout
    participant Socket as WS Transport

    rect rgb(235, 245, 255)
        note over Caller, PM: Normal Resolution Flow
        Caller->>PM: add(id, { resolve, reject }, timeoutMs)
        PM->>Timer: setTimeout(onTimeout, timeoutMs)
        PM-->>Caller: entry registered
        Socket-->>PM: Inbound Frame (id, payload)
        PM->>Timer: clearTimeout(timer)
        PM->>Caller: resolve(payload)
        PM->>PM: map.delete(id)
    end

    rect rgb(255, 240, 240)
        note over Caller, PM: Timeout Flow
        Caller->>PM: add(id, { resolve, reject }, 5000)
        PM->>Timer: setTimeout(onTimeout, 5000)
        Timer-->>PM: Timer fires (5000ms elapsed)
        PM->>PM: map.delete(id)
        PM->>Caller: reject(AxiosLikeError 408 ECONNABORTED)
    end
```

---

## 3. High-Level Design (HLD): Monorepo Position & Request Lifecycle

```mermaid
graph TD
    subgraph Monorepo["bxios Monorepo"]
        WirePackage["@bxios/wire Package"]
        ServerPackage["@bxios/server Package"]
        BxiosPackage["@bxios/bxios Package"]
    end

    subgraph ClientLifecycle["Client Request Lifecycle"]
        ClientApp["Client Application"]
        BxiosClient["bxios Client Instance"]
        PMap["PendingMap Correlation Engine"]
        WSTransport["WebSocket Transport"]
    end

    BxiosPackage --> PMap
    ClientApp -->|bxios.get / post| BxiosClient
    BxiosClient -->|1. Generate reqId & add to map| PMap
    BxiosClient -->|2. Send binary frame| WSTransport
    WSTransport -->|3. Recv frame response| BxiosClient
    BxiosClient -->|4. resolve reqId| PMap
    PMap -->|5. Resolve Promise| ClientApp
    WSTransport -.->|Disconnect Event| PMap
    PMap -.->|teardown reject all| ClientApp
```

---

## 4. Low-Level Design (LLD): Internal Flow & Disconnect Cleanup

```mermaid
flowchart TD
    A["PendingMap Action"] --> B{"Action Type?"}
    
    B -->|add id, pending| C["Calculate timeout = timeoutMs ?? pending.timeout ?? defaultTimeout"]
    C --> D{"timeout > 0?"}
    D -->|Yes| E["Start setTimeout timer"]
    D -->|No| F["No timer"]
    E --> G["Store in Map<id, PendingRequest>"]
    F --> G

    B -->|resolve id, value| H{"map.has(id)?"}
    H -->|Yes| I["clearTimeout(timer) if present"]
    I --> J["map.delete(id)"]
    J --> K["pending.resolve(value)"]
    H -->|No| L["Ignore"]

    B -->|reject id, reason| M{"map.has(id)?"}
    M -->|Yes| N["clearTimeout(timer) if present"]
    N --> O["map.delete(id)"]
    O --> P["pending.reject(reason)"]
    M -->|No| Q["Ignore"]

    B -->|teardown reason| R["Iterate all pending requests"]
    R --> S["For each: clearTimeout(timer), pending.reject(reason)"]
    S --> T["map.clear()"]

    E -.->|Timer Fires| U["map.delete(id)"]
    U --> V["Construct 408 ECONNABORTED error"]
    V --> W["pending.reject(error)"]
```
