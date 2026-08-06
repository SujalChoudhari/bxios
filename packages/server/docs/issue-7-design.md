# Issue #7 Design: Decorator Router & Parameter Injection for `@bxios/server`

## Executive Summary
This design document details the architecture and implementation of the decorator-based router and parameter injection engine in `@bxios/server`.

The system introduces standard TypeScript class (`@Controller`), method (`@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`), and parameter (`@Body`, `@Query`, `@Param`, `@Headers`, `@Context`) decorators, alongside a high-performance `RouteRegistry` for dynamic route compilation, parameter extraction, and request dispatching.

---

## 1. High-Level Design (HLD)

```mermaid
graph TD
    subgraph Client["Client Application"]
        Req["HTTP / WebSocket Request Context"]
    end

    subgraph ServerPackage["@bxios/server Router Subsystem"]
        subgraph Decorators["Decorators Engine"]
            Ctrl["@Controller(prefix)"]
            HttpDec["@Get / @Post / @Put / @Delete"]
            ParamDec["@Body / @Query / @Param / @Headers / @Context"]
        end

        subgraph Registry["RouteRegistry"]
            Reg["registerController(Class/Instance)"]
            Store["RouteDefinitions & Metadata Store"]
            Matcher["Route Matcher & Path-to-Regex"]
            ParamInj["Parameter Extractor & Injector"]
        end

        subgraph ControllerInstances["Controller Instances"]
            UserController["UserController"]
            ItemController["ItemController"]
        end
    end

    Ctrl --> Store
    HttpDec --> Store
    ParamDec --> Store
    Reg --> Store
    Req --> Matcher
    Matcher --> Store
    Matcher --> ParamInj
    ParamInj --> UserController
    ParamInj --> ItemController
```

---

## 2. Low-Level Design (LLD)

```mermaid
flowchart TD
    A["registry.registerController(TargetController)"] --> B["Instantiate Controller / Get Prototype"]
    B --> C["Read @Controller Prefix Metadata"]
    C --> D["Iterate Method Routes (@Get, @Post, etc.)"]
    D --> E["Combine Prefix + Route Path"]
    E --> F["Compile Path-to-Regex and Parameter Names"]
    F --> G["Extract & Sort @Body/@Query/@Param/@Headers/@Context Metadata"]
    G --> H["Store RouteDefinition in RouteRegistry.routes"]

    I["registry.dispatch(httpMethod, path, reqContext)"] --> J["Normalize Path & Strip Query String"]
    J --> K["Find Matching Route in RouteRegistry"]
    K -->|No Match| L["Throw Route Not Found Error"]
    K -->|Match Found| M["Extract Path Parameters into reqContext.params"]
    M --> N{"Has Parameter Decorator Metadata?"}
    N -->|Yes| O["Extract values for @Body, @Query, @Param, @Headers, @Context"]
    N -->|No| P["Fallback: Pass [reqContext] as argument"]
    O --> Q["Invoke Controller Method via handler.apply(instance, args)"]
    P --> Q
    Q --> R["Return Async Result / Response"]
```

---

## 3. Class & Interface Diagram

```mermaid
classDiagram
    class RequestContext {
        +method?: string
        +path?: string
        +url?: string
        +body?: any
        +query?: Record~string, any~
        +params?: Record~string, any~
        +headers?: Record~string, any~
        +context?: any
    }

    class ParamMetadata {
        +index: number
        +type: ParamType
        +key?: string
    }

    class MethodRouteMetadata {
        +httpMethod: string
        +path: string
        +propertyKey: string | symbol
    }

    class ControllerMetadata {
        +prefix: string
    }

    class RouteDefinition {
        +httpMethod: string
        +path: string
        +fullPath: string
        +propertyKey: string | symbol
        +handler: Function
        +instance: any
        +paramMetadata: ParamMetadata[]
        +regex: RegExp
        +paramNames: string[]
    }

    class RouteMatch {
        +route: RouteDefinition
        +params: Record~string, string~
        +handler: Function
        +instance: any
    }

    class RouteRegistry {
        -routes: RouteDefinition[]
        +registerController(controller: any): void
        +register(controller: any): void
        +getRoutes(): RouteDefinition[]
        +clear(): void
        +match(method: string, path: string): RouteMatch | null
        +dispatch(method: string, path: string, req?: RequestContext): Promise~any~
        +handle(req: RequestContext): Promise~any~
    }

    RouteRegistry "1" *-- "*" RouteDefinition : contains
    RouteDefinition "1" *-- "*" ParamMetadata : uses
    RouteMatch "1" o-- "1" RouteDefinition : references
    RouteRegistry ..> RequestContext : processes
    RouteRegistry ..> RouteMatch : produces
```

---

## 4. Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Caller as Server/App Caller
    participant Registry as RouteRegistry
    participant Matcher as Route Matcher
    participant Extractor as Parameter Extractor
    participant Target as Controller Instance Method

    Caller->>Registry: dispatch("GET", "/users/42?verbose=true", reqContext)
    Registry->>Matcher: match("GET", "/users/42")
    Matcher->>Matcher: Evaluate regex ^/users/([^/]+)$
    Matcher-->>Registry: RouteMatch { route, params: { id: "42" } }
    Registry->>Registry: Parse query string verbose=true into reqContext.query
    Registry->>Extractor: Extract values for method parameter decorators
    Extractor->>Extractor: Resolve @Param("id") -> "42"
    Extractor->>Extractor: Resolve @Query("verbose") -> "true"
    Extractor-->>Registry: args Array ["42", "true"]
    Registry->>Target: handler.apply(instance, ["42", "true"])
    Target-->>Registry: Return controller result Promise
    Registry-->>Caller: Resolved response data
```
