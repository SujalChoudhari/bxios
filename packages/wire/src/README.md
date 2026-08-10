# Wire source

This directory implements the `@bxios/wire` public entrypoint: validated MessagePack frame conversion, the minimal client-driver contract, and stream/auth frame helpers.

## Tracked contents

- `index.ts` — public exports.
- `types.ts` — `FrameType`, `FrameTuple`, and raw tuple types.
- `codec.ts` — validation plus MessagePack encode/decode.
- `errors.ts` — `FrameError` for invalid protocol data.
- `driver.ts` — `IDriver` and client callback types.
- `streaming.ts` — payload codecs and start/chunk/end/cancel/auth-refresh constructors.

## Navigation

The parent [`README.md`](../README.md) gives package context; [`../test/README.md`](../test/README.md) covers edge cases and [`../docs/README.md`](../docs/README.md) holds design notes. Consumers are [`../../bxios/src/`](../../bxios/src/) and [`../../server/src/`](../../server/src/).
