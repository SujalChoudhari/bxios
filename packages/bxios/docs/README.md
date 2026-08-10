# Client design notes

This directory captures client design decisions: request correlation, axios-like API/interceptors, and WebSocket connection lifecycle behavior.

## Tracked contents

- `DESIGN.md` — pending-request correlation engine.
- `api-interceptors-design.md` — API client and interceptor pipeline.
- `connection-manager-design.md` — connection manager behavior.

## Navigation

Map designs to modules through [`../src/README.md`](../src/README.md) and behavior through [`../test/README.md`](../test/README.md). The shared protocol notes are [`../../wire/docs/README.md`](../../wire/docs/README.md); the counterpart server notes are [`../../server/docs/README.md`](../../server/docs/README.md).
