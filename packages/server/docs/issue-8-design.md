# Issue #8 Design: Zod Validation & Error Handler Middleware for `@bxios/server`

## Executive Summary
This design document details the architecture and implementation of Zod schema validation and error handling middleware for `@bxios/server`.

The system integrates Zod schema parsing into method parameter injection decorators (`@Body`, `@Query`, `@Param`, `@Headers`, `@Context`), returning a 400 Bad Request status tuple frame with field-level validation details upon validation failure, and catching uncaught route exceptions to format them into standard 500 Internal Server Error status tuple frames compatible with `@bxios/wire`.

---

## 1. High-Level Design (HLD)

```mermaid
graph TD
    subgraph Client["Client Application / Caller"]
        Req["Request Context (body, query, params, headers, id)"]
    end

    subgraph ServerPackage["@bxios/server Validation & Error Handler Subsystem"]
        subgraph Decorators["Parameter Decorators with Zod"]
            BodyDec["@Body(schema)"]
            QueryDec["@Query(schema)"]
            ParamDec["@Param(schema)"]
            HeaderDec["@Headers(schema)"]
        end

        subgraph Registry["RouteRegistry Pipeline"]
            Match["Route Matcher"]
            Extract["Parameter Extractor & Zod Validator"]
            Invoke["Route Handler Execution"]
            ErrCatch["Error Catching & Response Formatter"]
        end

        subgraph TupleFrames["Status Tuple Frame Engine"]
            Frame400["400 Bad Request Frame (Field Details)"]
            Frame500["500 Internal Server Error Frame"]
        end
    end

    Req --> Match
    Match --> Extract
    Decorators --> Extract
    Extract -->|Valid| Invoke
    Extract -->|Invalid Schema| ErrCatch
    Invoke -->|Uncaught Exception| ErrCatch
    ErrCatch --> Frame400
    ErrCatch --> Frame500
```

---

## 2. Low-Level Design (LLD)

```mermaid
flowchart TD
    A["dispatch(method, path, reqContext)"] --> B["Match HTTP Route"]
    B -->|No Match| C["Throw Route Not Found Error"]
    B -->|Route Match Found| D["Begin try block"]
    D --> E["Extract Parameter Metadata List"]
    E --> F{"Parameter has Zod Schema?"}
    F -->|No Schema| G["Extract Raw Value"]
    F -->|Has Schema| H["Run schema.safeParseAsync(rawValue) when available, otherwise safeParse"]
    H -->|Success| I["Use parsed/coerced data as argument"]
    H -->|Failure| J["Throw ValidationError with Zod field details"]
    G --> K["Assemble Arguments Array"]
    I --> K
    K --> L["Execute Handler: handler.apply(instance, args)"]
    L --> M["Return Handler Result"]
    J --> N["Catch Error in catch block"]
    L -->|Uncaught Exception| N
    N --> O{"Error Type?"}
    O -->|ValidationError / ZodError| P["Format 400 Bad Request ErrorTupleFrame"]
    O -->|HttpError / Other Error| Q["Format 500 / Status ErrorTupleFrame"]
    P --> R["Return Status Tuple Frame"]
    Q --> R
```

---

## 3. Class & Interface Diagram

```mermaid
classDiagram
    class RequestContext {
        +id?: string
        +method?: string
        +path?: string
        +body?: any
        +query?: Record~string, any~
        +params?: Record~string, any~
        +headers?: Record~string, any~
    }

    class ParamMetadata {
        +index: number
        +type: ParamType
        +key?: string
        +schema?: any
    }

    class ValidationDetail {
        +field: string
        +path: (string | number)[]
        +message: string
        +code: string
    }

    class ErrorPayload {
        +statusCode: number
        +error: string
        +message: string
        +details?: ValidationDetail[]
    }

    class FrameTuple {
        +type: FrameType
        +id: string
        +streamId?: number
        +data: Uint8Array
        +metadata?: Record~string, unknown~
        +code?: number
    }

    class ErrorTupleFrame {
        +rawTuple: RawFrameTuple
        +payload: ErrorPayload
    }

    class ValidationError {
        +statusCode: number
        +details: ValidationDetail[]
    }

    class RouteRegistry {
        -routes: RouteDefinition[]
        +dispatch(method: string, path: string, req?: RequestContext): Promise~any~
        +handle(req: RequestContext): Promise~any~
    }

    FrameTuple <|-- ErrorTupleFrame
    ErrorTupleFrame "1" *-- "1" ErrorPayload : contains
    ErrorPayload "1" *-- "*" ValidationDetail : details
    RouteRegistry ..> ValidationError : catches
    RouteRegistry ..> ErrorTupleFrame : produces
    ParamMetadata ..> ValidationDetail : generates on invalid schema
```

---

## 4. Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Caller as Request Dispatcher
    participant Registry as RouteRegistry
    participant Extractor as Param Extractor & Zod Validator
    participant Handler as Route Handler Method
    participant ErrorEngine as Error Frame Engine

    Caller->>Registry: dispatch("POST", "/api/v1/users", reqContext)
    Registry->>Registry: Match route /api/v1/users
    Registry->>Extractor: Extract and validate parameters
    Extractor->>Extractor: Run Zod schema.safeParseAsync(reqContext.body) when available
    alt Validation Failure
        Extractor-->>Registry: throw ValidationError(details)
        Registry->>ErrorEngine: createErrorTupleFrame(400, "Validation failed", details, reqId)
        ErrorEngine-->>Caller: 400 Bad Request ErrorTupleFrame
    else Validation Success
        Extractor-->>Registry: Extracted & parsed args
        Registry->>Handler: handler.apply(instance, args)
        alt Handler Execution Success
            Handler-->>Caller: Handler result
        else Handler Uncaught Exception
            Handler-->>Registry: throw Error("Database failure")
            Registry->>ErrorEngine: createErrorTupleFrame(500, "Database failure", undefined, reqId)
            ErrorEngine-->>Caller: 500 Internal Server Error ErrorTupleFrame
        end
    end
```
