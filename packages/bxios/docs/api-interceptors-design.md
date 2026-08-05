# Axios-compatible Method Suite & Interceptors Design Document

## Overview
`@bxios/bxios` provides an Axios-compatible API suite (`get`, `post`, `put`, `delete`, `patch`, `head`, `options`), request and response interceptors via `InterceptorManager`, and standard W3C `AbortSignal` request cancellation.

---

## 1. Class & Interface Diagram

```mermaid
classDiagram
    class AxiosRequestConfig~D~ {
        <<interface>>
        +string url
        +string method
        +string baseURL
        +Record~string, string~ headers
        +Record~string, any~ params
        +D data
        +number timeout
        +AbortSignal signal
        +adapter?: Function
    }

    class AxiosResponse~T, D~ {
        <<interface>>
        +T data
        +number status
        +string statusText
        +Record~string, string~ headers
        +AxiosRequestConfig~D~ config
    }

    class InterceptorHandler~T~ {
        <<interface>>
        +InterceptorFulfilled~T~ fulfilled
        +InterceptorRejected rejected
        +boolean synchronous
        +runWhen?: Function
    }

    class InterceptorManager~V~ {
        -Array~InterceptorHandler~V~ | null~ handlers
        +use(fulfilled, rejected, options): number
        +eject(id: number): void
        +clear(): void
        +forEach(fn): void
        +length: number
    }

    class Bxios {
        +AxiosRequestConfig defaults
        +interceptors: { request, response }
        +dispatchRequest(config): Promise~AxiosResponse~
        +request(configOrUrl, config): Promise~R~
        +get(url, config): Promise~R~
        +post(url, data, config): Promise~R~
        +put(url, data, config): Promise~R~
        +delete(url, config): Promise~R~
        +patch(url, data, config): Promise~R~
        +head(url, config): Promise~R~
        +options(url, config): Promise~R~
    }

    Bxios *-- InterceptorManager : request & response interceptors
    InterceptorManager *-- InterceptorHandler : stores
    Bxios ..> AxiosRequestConfig : consumes
    Bxios ..> AxiosResponse : produces
```

---

## 2. Sequence Diagram: Interceptors, Dispatch & AbortSignal

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Client Application
    participant Bxios as Bxios Instance
    participant ReqInt as Request Interceptors
    participant Dispatch as dispatchRequest Engine
    participant ResInt as Response Interceptors
    participant Signal as AbortSignal

    Caller->>Bxios: bxios.get("/url", { signal })
    Bxios->>ReqInt: Execute async request interceptors (reverse order)
    ReqInt-->>Bxios: Transformed AxiosRequestConfig

    alt AbortSignal already aborted
        Bxios-->>Caller: Reject CanceledError (ERR_CANCELED)
    else Request in flight
        Bxios->>Signal: addEventListener('abort')
        Bxios->>Dispatch: dispatchRequest(config)
        
        alt Signal abort event fires
            Signal-->>Dispatch: 'abort' event fired
            Dispatch-->>Caller: Reject CanceledError (ERR_CANCELED)
        else Normal Response
            Dispatch-->>ResInt: AxiosResponse
            ResInt->>ResInt: Execute async response interceptors (FIFO order)
            ResInt-->>Caller: Final AxiosResponse Promise
        end
    end
```

---

## 3. High-Level Design (HLD): API Suite Architecture

```mermaid
graph TD
    subgraph ClientApplication["Client Code"]
        App["App Logic"]
    end

    subgraph BxiosSuite["@bxios/bxios API Suite"]
        MethodSuite["Verb Methods (get, post, put, delete, etc.)"]
        InterceptorEngine["InterceptorManager (Req/Res Chains)"]
        Dispatcher["dispatchRequest Engine"]
        AbortHandler["AbortSignal Cancellation Controller"]
    end

    subgraph TransportLayer["Transport & Wire Layer"]
        PendingMap["PendingMap Correlation"]
        WireDriver["IDriver Transport / Adapter"]
    end

    App -->|bxios.get / post| MethodSuite
    MethodSuite --> InterceptorEngine
    InterceptorEngine -->|Transformed Config| Dispatcher
    Dispatcher --> AbortHandler
    AbortHandler -->|In-flight Execution| PendingMap
    PendingMap --> WireDriver
```

---

## 4. Low-Level Design (LLD): Interceptor Chain & Cancellation Flowchart

```mermaid
flowchart TD
    A["bxios.request(configOrUrl, config)"] --> B["Merge defaults with request config"]
    B --> C["Construct Interceptor Chain:<br/>[...ReqInterceptors, dispatchRequest, ...ResInterceptors]"]
    C --> D["Init Promise = Promise.resolve(config)"]

    D --> Loop{"Chain Has Next Step?"}
    Loop -->|Yes| ExecStep["promise = promise.then(fulfilled, rejected)"]
    ExecStep --> Loop

    Loop -->|Reached dispatchRequest| CheckSignal{"config.signal?.aborted?"}
    CheckSignal -->|True| RejectCanceled["Reject with CanceledError (ERR_CANCELED)"]
    CheckSignal -->|False| AttachListener["Attach 'abort' event listener to signal"]

    AttachListener --> ExecAdapter{"Custom adapter provided?"}
    ExecAdapter -->|Yes| RunAdapter["Invoke adapter(config)"]
    ExecAdapter -->|No| DefaultAdapter["Execute default dispatch / PendingMap correlation"]

    RunAdapter --> OnDone["Remove 'abort' listener & return response/error"]
    DefaultAdapter --> OnDone
    OnDone --> Loop
```
