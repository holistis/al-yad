# Contributing to Yad

Yad is early. There is no formal process here, just a few things worth knowing before you open a PR.

## Before you start

For anything more than a small fix, open an issue first describing what you want to change and why. Saves both of us the work if it turns out to be out of scope or already planned.

## Setup

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

All four need to pass before you open a PR. CI runs the same four checks plus a license check on every push and pull request, so a red CI run is the same thing you'd see locally.

## What the packages are

- `packages/shared`: types and the protocol between the extension and the companion app.
- `packages/companion`: the "brain". Native-messaging host, agent loop, LLM routing, memory (action-cache, recovery-store).
- `packages/extension`: the "hand". The MV3 Chrome extension that executes actions in the browser.
- `packages/dashboard`: an in-progress multi-task orchestrator UI, single-tenant, no auth yet.
- `packages/desktop-app`: an early standalone-window prototype, not packaged for end users yet.

## License discipline

MIT/Apache-2.0 dependencies only, no AGPL. `pnpm check-licenses` enforces this and CI fails if it doesn't pass. If a dependency you want to add fails that check, it's a hard no, not something to work around.

## Style

No em-dashes, no double-asterisk bold in prose that ships to end users (site copy, README, error messages users see). Plain punctuation, short sentences. Code comments should explain the why, not the what, and only when it's genuinely non-obvious.

## Scope

Browser and OS support you can help with right now: Firefox support (different extension format, not started), macOS support for the companion (the key-encryption layer uses Windows DPAPI today, would need a Keychain equivalent), and the desktop-app installer (currently requires building from source).

## Questions

Open an issue, or email info@mergefix.com.
