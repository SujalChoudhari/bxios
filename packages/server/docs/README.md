# Server design notes

These documents describe the `@bxios/server` driver abstraction plus server backpressure, authentication, routing/validation, and streaming.

## Tracked contents

- `DESIGN.md` — driver architecture and uWebSockets.js buffer-copy contract.
- `issue-7-design.md` — streaming server design.
- `issue-8-design.md` — routing and validation design.
- `issue-9-design.md` — authentication design.

## Navigation

Use [`../src/README.md`](../src/README.md) for implementation modules and [`../test/README.md`](../test/README.md) for checks. Repository-level auth/backpressure notes are in [`../../../docs/README.md`](../../../docs/README.md); protocol foundations are in [`../../wire/docs/README.md`](../../wire/docs/README.md).
