# yadagent

Part B of [Yad](https://yadagent.com), the companion (the brain).

Yad is two separate pieces you install separately:

- **Part A, the hand**: the Yad browser extension. Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/dacfhekkemkiikecbjffmbdcohddodea). Also works in Brave.
- **Part B, the brain**: this package. It runs locally on your machine and either pairs with Part A to drive your own real, logged-in browser, or runs on its own as a standalone automation server.

Source and full docs: [github.com/holistis/al-yad](https://github.com/holistis/al-yad)

## Two modes, not one

This package does not try to hide that it has two genuinely different modes behind one CLI. Picking the wrong one for what you actually want is worse than reading one extra paragraph first.

### `npx yadagent pair`

Sets up native messaging so this companion can pair with the Yad Chrome extension (Part A) and drive **your own real, logged-in browser**. Your session, your cookies, your logins, nothing carried anywhere else.

Windows only today for the registration step. macOS and Linux support is an open, tracked task in the project's CONTRIBUTING.md, not a silent gap. Running this on another OS still generates the pairing manifest correctly, it just tells you plainly that the registration step is not there yet for your platform, instead of failing confusingly.

You still need to install the extension itself from the Chrome Web Store separately. This command only sets up the local half of the pairing.

The registration points Chrome at this exact copy of the package, wherever `npx` happened to install it. If you run `pair` from a throwaway project and later delete that project, the pairing breaks and needs to be set up again from wherever you keep it. For a pairing that should stick around, install globally first (`npm install -g yadagent`) and run `pair` from there instead of through a one-off `npx`.

### `npx yadagent serve`

Runs a standalone HTTP automation server. No browser extension, no paired session. Headless Chromium via Playwright, your own [Ollama](https://ollama.com) instance for the model. Cross-platform.

Every run starts a fresh, empty browser. Nothing from your real browser profile carries over, no saved logins, no cookies. That is a real tradeoff, not a limitation to work around: if you want your own logged-in session, that is what `pair` is for.

```bash
OLLAMA_BASE_URL=http://localhost:11434 npx yadagent serve
```

Environment variables:

| Variable | Required | Default | What it does |
|---|---|---|---|
| `OLLAMA_BASE_URL` | yes | none | Where your Ollama instance is reachable |
| `OLLAMA_MODEL` | no | `qwen2.5:7b` | Which model to use |
| `YAD_PORT` | no | `3747` | Port to listen on |
| `YAD_HOST` | no | `0.0.0.0` | Interface to bind to |

Endpoints once running: `GET /status`, `POST /goal` (body: `{ goal, url?, domains?, maxSteps?, sync? }`).

Built-in guardrails, always on regardless of configuration: a hard concurrency limit, goal text sanitization, a scope guard that blocks actions outside domains you allow, and a hard deny-list on payment and checkout paths.

## What this package will never do

No cloud copy of your browser session. No data leaves your machine except the model calls you already configured (your own Ollama instance, or in `pair` mode, whatever the extension is set to use). Read the security writeup at [yadagent.com](https://yadagent.com) for the fuller picture, including the project's own red-team testing results, published rather than just claimed.

MIT licensed.
