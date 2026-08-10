# Wire tests

These Vitest tests protect the shared protocol boundary by validating codec behavior and the client-side `IDriver` callback contract.

## Tracked contents

- `codec.test.ts` — valid MessagePack frame round-trips and invalid-frame rejection.
- `driver.test.ts` — driver callback and interface expectations.

## Navigation

Run `pnpm --filter @bxios/wire test`. Match tests to [`../src/README.md`](../src/README.md) and designs in [`../docs/README.md`](../docs/README.md). Cross-package transport behavior is in [`../../../e2e/README.md`](../../../e2e/README.md).
