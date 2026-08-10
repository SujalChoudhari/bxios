# bxios vs conventional API: single-client and multi-client local benchmarks

These are bounded, reproducible loopback microbenchmarks. They compare the existing single-client baseline with a follow-up matrix that asks how the paths behave with 1, 10, and 100 independent clients. They are not production load tests and do not establish a universal transport ranking.

## Harnesses and exact commands

- Original baseline: [`benchmarks/bxios-vs-regular-api.mjs`](../benchmarks/bxios-vs-regular-api.mjs), run with `pnpm benchmark`.
- Follow-up matrix: [`benchmarks/bxios-multi-client.mjs`](../benchmarks/bxios-multi-client.mjs), run with `pnpm benchmark:multi`.

`pnpm benchmark` is preserved unchanged as the original single-client benchmark. `pnpm benchmark:multi` builds the workspace first, then runs the matrix and prints JSON to stdout. The matrix is bounded at 5 warm-up rounds and 40 measured rounds for each client count, with counts `[1, 10, 100]`; all three counts completed with zero errors in the recorded run.

## Method

The matrix compares four paths:

- **Regular HTTP JSON unary:** one HTTP/1.1 keep-alive `http.Agent` with `maxSockets: 1` per client.
- **bxios MessagePack/WebSocket unary:** one persistent `ConnectionManager` WebSocket per client; unary frames are encoded/decoded through the real bxios wire helpers.
- **Regular HTTP SSE:** one keep-alive HTTP agent with `maxSockets: 1` per client; each operation receives 10 SSE events.
- **bxios multiplexed streaming:** one persistent WebSocket and one `MultiplexedStreamingClient` per client; each operation receives 10 MessagePack stream chunks. There is one active stream per client in this matrix, so this tests independent-client concurrency rather than multiple simultaneous stream IDs on one connection.

A “client” is explicitly one independent warmed connection: an HTTP agent constrained to one socket, or one WebSocket connection. Each client performs the same operation once per synchronized round. The harness awaits `Promise.all` for all clients before starting the next round, so operations are concurrent within a round and the same iteration policy is used across transports. Five synchronized warm-up rounds are outside measurement; forty rounds are timed. The timer around each operation uses `performance.now()` and includes request send, server work, transport delivery, and client parsing/decoding. Aggregate throughput uses the wall-clock duration for all measured rounds and counts every client operation.

All paths use the same 256-byte payload, fixed in-memory server work, and 10 values/events for streaming. The server runs in the same Node process on `127.0.0.1`; setup and connection handshakes are outside the timed region. Errors are caught per operation and reported rather than dropped. Memory is not reported because no reproducible memory protocol was added.

## Recorded environment and exact output

Recorded 2026-08-10 09:09 UTC on Node.js v22.23.2, Linux x64, loopback. This is the second run; the benchmark was run twice and run 2 was selected because both completed without errors and its results were the later captured run. Exact command:

```sh
pnpm benchmark:multi > /tmp/bxios-multi-run-2.json
```

The command's build prefix is included in the capture; the JSON result was:

```json
{
  "environment": { "node": "v22.23.2", "platform": "linux", "arch": "x64" },
  "config": { "client_counts": [1, 10, 100], "warmup": 5, "iterations": 40, "chunks": 10, "payload_bytes": 256, "clock": "performance.now() (Node monotonic clock)", "synchronization": "Promise.all per round", "client_definition": "one independently warmed persistent HTTP agent or WebSocket connection per client" }
}
```

Full raw result table from that JSON:

| Transport | Clients | Median (ms) | p95 (ms) | p99 (ms) | Throughput (ops/s) | Errors | Operations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| regular_http_json | 1 | 0.355 | 0.574 | 0.632 | 2,636.212 | 0 | 40 |
| bxios_msgpack_websocket | 1 | 0.365 | 0.708 | 1.669 | 2,391.751 | 0 | 40 |
| regular_http_sse | 1 | 0.537 | 0.735 | 0.835 | 1,796.831 | 0 | 40 |
| bxios_multiplexed_msgpack_websocket | 1 | 1.025 | 3.619 | 4.381 | 714.003 | 0 | 40 |
| regular_http_json | 10 | 2.012 | 2.858 | 4.501 | 4,175.845 | 0 | 400 |
| bxios_msgpack_websocket | 10 | 1.142 | 1.990 | 3.384 | 7,127.629 | 0 | 400 |
| regular_http_sse | 10 | 2.290 | 3.392 | 4.118 | 3,519.641 | 0 | 400 |
| bxios_multiplexed_msgpack_websocket | 10 | 4.062 | 9.650 | 11.101 | 1,794.949 | 0 | 400 |
| regular_http_json | 100 | 11.508 | 16.087 | 23.867 | 7,225.875 | 0 | 4,000 |
| bxios_msgpack_websocket | 100 | 8.873 | 11.266 | 12.134 | 9,997.256 | 0 | 4,000 |
| regular_http_sse | 100 | 14.543 | 18.303 | 19.732 | 5,838.787 | 0 | 4,000 |
| bxios_multiplexed_msgpack_websocket | 100 | 31.732 | 40.113 | 43.138 | 2,710.657 | 0 | 4,000 |

## Interpretation

In this run, unary bxios was slightly slower at one client but had lower median/p95 and higher aggregate throughput at 10 and 100 clients. The regular SSE path had lower latency and higher throughput than bxios multiplexed streaming at every tested count, with the gap widening at 100 clients. Latency rose as synchronized client count increased, while aggregate throughput rose because more operations were in flight. This describes this harness and host—not a universal “10x” result.

## Limitations and architecture context

- **Loopback only:** both servers and clients run on one local machine, with no WAN, TLS, proxy, disk, database, authentication, compression, or application middleware.
- **Warm connections:** connection setup and WebSocket handshakes are excluded. HTTP pooling, HTTP/2, or HTTP/3 could change the regular API baseline substantially; this harness intentionally uses independent HTTP/1.1 keep-alive agents.
- **Node runtime and local CPU:** results are from Node.js v22.23.2 on one Linux x64 host. Scheduling, GC, CPU frequency, kernel networking, and the `ws` implementation affect the numbers.
- **Not a production load test:** 100 clients and 4,000 operations per row are a bounded development workload, not capacity, saturation, resilience, or long-duration soak evidence.
- **Streaming semantics:** each operation emits 10 immediately generated values/events and has one active stream per client. It does not model delayed producers, slow consumers, cancellation-heavy workloads, or realistic backpressure.
- **TCP head-of-line:** a single TCP connection can experience ordered delivery and head-of-line effects. The matrix uses one connection per client, so it does not answer whether many logical streams on fewer connections are preferable.
- **Per-connection memory:** independent connections have handshake state, buffers, timers, and socket overhead. Memory was not measured reproducibly here, so no memory conclusion is claimed.
- **Server scheduling/backpressure:** all work is in one Node event loop and the server emits small responses immediately. Real scheduling, queues, backpressure, and proxy buffering may dominate elsewhere.
- **Payload and implementation:** the fixed 256-byte payload and low-level endpoint are deliberately simple. MessagePack/JSON size and CPU trade-offs vary with schemas and data.
- **One benchmark cannot settle architecture:** transport choice also depends on deployment topology, observability, retries, browser/platform support, operational familiarity, HTTP caching, intermediaries, protocol evolution, and workload shape. Use workload-specific tests before making an architecture decision.

The detailed harness output is intentionally JSON so it can be captured, diffed, and re-run without an extra parser.
