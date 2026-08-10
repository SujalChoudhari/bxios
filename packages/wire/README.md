# @bxios/wire

`@bxios/wire` is the shared binary protocol foundation. It defines validated six-field MessagePack frames, transport driver callbacks, and frame constructors used by client and server packages.

## Tracked contents

- `package.json` — metadata, MessagePack dependency, and build/test scripts.
- `tsconfig.json` — TypeScript configuration.
- `src/` — protocol types, codec, transport contract, errors, and streaming helpers.
- `test/` — codec and driver-contract unit tests.
- `docs/` — protocol and driver design notes.

## Navigation

Read [`src/README.md`](src/README.md) for modules, [`test/README.md`](test/README.md) for assertions, and [`docs/README.md`](docs/README.md) for design history. The root [`README.md`](../../README.md) states the tuple contract. Sibling consumers are [`../bxios/`](../bxios/) and [`../server/`](../server/).
