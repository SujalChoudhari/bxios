# bxios vs conventional API: local microbenchmark

This benchmark compares the current bxios transport implementation with conventional local Node.js HTTP paths. It is a reproducible microbenchmark, not a claim about universal performance.

## Harness and command

The committed harness is [`benchmarks/bxios-vs-regular-api.mjs`](../benchmarks/bxios-vs-regular-api.mjs). It starts all four endpoints in one Node process on `127.0.0.1`:

- **bxios unary:** `ConnectionManager` + `WSServerDriver`, binary MessagePack `Unary` frames, one persistent WebSocket connection.
- **Regular unary:** Node `fetch` to an HTTP/1.1 JSON endpoint, with a persistent undici connection pool.
- **bxios streaming:** `MultiplexedStreamingClient` + `MultiplexedStreamingEngine`, one persistent WebSocket connection, 10 MessagePack stream chunks.
- **Regular streaming:** Node `fetch` to an HTTP `text/event-stream` endpoint, 10 SSE events.

Run from the repository root:

```sh
pnpm benchmark
```

The script prints JSON so results can be captured without an extra parser. It requires the repository's existing Node/pnpm dependencies and does not add production dependencies.

## Methodology

| Setting | Value |
| --- | --- |
| Runtime | Node.js v22.23.2, Linux x64 (the recorded run environment) |
| Host | loopback only: `127.0.0.1`; no TLS, proxy, WAN, disk, or database |
| Clock | `performance.now()` (`node:perf_hooks` monotonic clock) around each complete client operation |
| Warm-up | 30 sequential operations per path before samples |
| Samples | 300 sequential operations per path; concurrency 1 |
| Unary payload | same request fields and fixed 256-byte string; same `{ ok, value, payload }` response |
| Streaming payload | same 256-byte string in each of 10 chunks/events; same indexes and values |
| Server work | fixed in-memory response; streaming loops exactly 10 generated values/events |
| Reported | median, p95, arithmetic mean, and completed operations per second |

The unary timer includes request send, server decode/encode or JSON handling, transport delivery, and client decode/parse. The streaming timer includes opening the request and receiving all 10 values/events. Setup is intentionally outside the timed region: both comparisons reuse a warmed connection. This isolates request/stream operation behavior; it does **not** measure initial WebSocket handshake or HTTP connection establishment.

For size context, the run measured a 300-byte JSON unary response, a 330-byte representative bxios unary request frame, a 288-byte SSE event, and a 295-byte representative bxios stream-chunk frame. These are wire payload examples, not a full protocol-overhead accounting.

## Recorded results

Results from `pnpm benchmark` on the environment above:

| Path | Median (ms) | p95 (ms) | Mean (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: | ---: |
| Regular HTTP JSON unary | 1.822 | 2.209 | 1.791 | 558.20 |
| bxios MessagePack/WebSocket unary | 0.127 | 0.248 | 0.155 | 6,463.19 |
| Regular HTTP SSE stream (10 events) | 1.727 | 2.148 | 1.745 | 572.99 |
| bxios multiplexed MessagePack/WebSocket stream (10 chunks) | 0.508 | 1.048 | 0.646 | 1,549.15 |

In this run, the warmed bxios path had lower request-operation latency and higher loopback throughput for both workloads. The result is specific to this implementation, payload, Node runtime, sequential concurrency, and local machine. It should not be generalized to WAN latency, TLS, proxies, browser stacks, large payloads, high concurrency, or workloads where HTTP infrastructure is already optimized.

## Interpretation and limitations

- Connection reuse matters. This run excludes initial setup for both protocols. A request that must open a WebSocket, or a deployment that already has a pooled HTTP/2/HTTP/3 connection, can produce a different comparison.
- This is a transport/client-path microbenchmark. It does not compare a production HTTP framework, compression, authentication, TLS, routing middleware, browser behavior, or a real application workload.
- The SSE endpoint writes all events immediately. It verifies complete event delivery and parsing, but does not model producer delays or backpressure in a remote deployment.
- The bxios stream exercises multiplexed framing and the real `MultiplexedStreamingEngine`, but only one concurrent stream is timed. Multiplexing benefits should be measured separately with a workload that shares a connection across concurrent stream IDs.
- MessagePack and JSON sizes depend on schema and data. The fixed payload intentionally makes the two paths comparable; it is not representative of every API response.
- Re-run the command on the target hardware and record the emitted environment/results before using the numbers for a decision.
