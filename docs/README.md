# Repository design notes

Cross-package design notes for bxios. Package-specific designs remain with their package.

## Tracked contents

- `e2e-release-design.md` — release E2E design.
- `issue-10-dynamic-backpressure-design.md` — streaming backpressure.
- `issue-11-handshake-auth-design.md` — handshake authentication.
- `readme-design.md` — root README design.
- `folder-navigation-design.md` — directory README navigation design.

## Navigation

Start at the repository [`README.md`](../README.md). Then use package-level docs in [`packages/wire/`](../packages/wire/), [`packages/bxios/`](../packages/bxios/), and [`packages/server/`](../packages/server/). The runnable integration contract is in [`e2e/`](../e2e/); the consumer example is [`examples/react-bxios/`](../examples/react-bxios/).
