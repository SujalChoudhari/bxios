# Client tests

These Vitest tests exercise independently testable `@bxios/bxios` behavior: axios-like request flow, connection state/reconnect behavior, and pending request correlation and cleanup.

## Tracked contents

- `api.test.ts` — request methods, defaults, cancellation, and interceptors.
- `connection.test.ts` — `ConnectionManager` lifecycle and reconnect behavior.
- `pending-map.test.ts` — resolution, rejection, timeout, and teardown.

## Navigation

Run `pnpm --filter @bxios/bxios test`. The matching modules are in [`../src/README.md`](../src/README.md); rationale is in [`../docs/README.md`](../docs/README.md). The real client/server route is in [`../../../e2e/README.md`](../../../e2e/README.md).
