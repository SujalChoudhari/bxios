# Server tests

These Vitest suites verify `@bxios/server` at unit and transport-integration levels: drivers/authentication, decorated routing, validation error frames, and multiplexed streaming.

## Tracked contents

- `driver.test.ts` — `ws`/uWebSockets.js drivers, factory, auth, and buffer handling.
- `router.test.ts` — decorators, matching, parameter extraction, and registry behavior.
- `validation.test.ts` — Zod validation and protocol-shaped errors.
- `streaming.integration.test.ts` — streaming over a real WebSocket transport.

## Navigation

Run `pnpm --filter @bxios/server test`. Locate modules in [`../src/README.md`](../src/README.md) and rationale in [`../docs/README.md`](../docs/README.md). The full three-package route is covered by [`../../../e2e/README.md`](../../../e2e/README.md).
