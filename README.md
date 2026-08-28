# Yad (يد), self-hostable, privacy-first AI browser automation agent

[![CI](https://github.com/holistis/al-yad/actions/workflows/ci.yml/badge.svg)](https://github.com/holistis/al-yad/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Built by [Abdellah Ouadoudi](https://github.com/holistis)

## Demo

https://yadagent.com/yad-invoice-demo-en.mp4

Unedited recording, not a mockup: Yad reads an invoice on one screen and types the data into the other, using your own logged-in session and no API integration between the two systems.

## Website / homepage / live URL

- **The YAD website (live landing page): https://yadagent.com**, own domain, purchased 2026-08-25, migrated live 2026-08-26. Also live in Dutch as a second language, every page has an `-nl` counterpart (for example `/yad-nl`, `/yad-business-nl`). Served from the same server as before (nginx vhost proxies `/` to the `/yad` route on the x402 server). The old https://wazir-x402.duckdns.org/yad URL still works and serves the same content, but yadagent.com is now the canonical one.
- **Chrome Web Store listing** (install page): https://chromewebstore.google.com/detail/dacfhekkemkiikecbjffmbdcohddodea, live and installable today.
- **Microsoft Edge Add-ons**: submitted 2026-08-26, in review (Microsoft's own estimate is about 7 business days).
- **Brave**: supported today, no separate submission needed. Brave installs the same Chrome Web Store extension directly, verified working via a real native-messaging handshake test, not assumed.
- Landing page source lives in `site/index.html`; the deployed copy lives at `/app/euler-liquidator/data/yad-landing.html` on the server. nginx config for the domain: `/etc/nginx/sites-available/yadagent` on the Hetzner box.

**Yad** ("the hand" in Arabic) is a thin Chrome extension (the Hand) controlled by a locally hosted brain (the Companion). It works inside the user's real, logged-in browser session, learns a task once, and then repeats it deterministically at near-zero cost.

> **Benchmark results** (gpt-4o-mini, July 2025):
> 92% fully correct on 25-task open benchmark · 100% on 5 authenticated tasks · 100% pass+partial · avg 2.7 steps · avg 8.7s per task
> → See [Benchmark](#benchmark) section below.

## Architecture

- `packages/shared`: shared types/protocol between Hand and Brain.
- `packages/companion`: the Brain. Native-messaging host, agent-loop, engine (LLM-router), memory (action-cache, recovery-store), key (session/vault), gate (guardrails).
- `packages/extension`: the Hand. MV3 extension (WXT), keeps native-messaging port open, executes actions. Chrome and Brave live today, Edge submitted and in review.
- `packages/dashboard`: v1 orchestrator UI in front of `main-server.ts`, an in-memory job-queue, worker-pool and a single polling page (single-tenant, no auth/billing yet, multi-tenant control and billing is a later phase, not built).
- `packages/desktop-app`: an early, working prototype of Yad as a standalone program window, no browser extension needed. Real and tested, not a mockup, but not yet a one-click installer. Requires building from source.

## Benchmark

YAD includes a fully open, reproducible benchmark suite. Every task definition, scoring script, and result file is checked into this repository, anyone can reproduce the numbers by running `pnpm benchmark`.

### Results (July 2025, gpt-4o-mini via OpenRouter)

| Suite | Tasks | Fully correct | Pass+partial | Avg steps | Avg time |
|-------|-------|---------------|--------------|-----------|----------|
| Main (25 tasks) | product-research, content-extraction, web-research, news-monitoring | **23/25 (92%)** | 25/25 (100%) | 2.7 | 8.7s |
| Auth (5 tasks) | authenticated login + extract | **5/5 (100%)** | 5/5 (100%) | 6.0 | 25.5s |
| Extended (10 tasks) | academic-research (ArXiv), reference-lookup (Cambridge Dict.), code-research (GitHub) | **10/10 (100%)** | 10/10 (100%) | 1.9 | 8.2s |
| **Combined (all suites)** | **40 tasks** | **38/40 (95%)** | **40/40 (100%)** | n/a | n/a |

Results by difficulty (main suite):

| Difficulty | Fully correct | Score |
|------------|---------------|-------|
| Easy (11 tasks) | 10/11 | 91% |
| Medium (11 tasks) | 10/11 | 91% |
| Hard (3 tasks) | 3/3 | 100% |

### Task categories

- **product-research** (8 tasks): navigate catalogue, find cheapest/rated item, open product page, read description
- **content-extraction** (7 tasks): read quotes, list authors, filter by tag, navigate to page 2, visit author profile
- **web-research** (5 tasks): Wikipedia infobox facts, publication years, geography
- **news-monitoring** (5 tasks): HackerNews titles, points, most-commented story
- **authenticated** (5 tasks): full login flow on saucedemo.com, sort, filter, navigate product pages
- **academic-research** (5 tasks): ArXiv paper titles, authors, abstracts
- **reference-lookup** (3 tasks): Cambridge Dictionary definitions
- **code-research** (2 tasks): GitHub public repository info

### How to run

Dependencies must be installed first, see [Install](#install).

```bash
# Run full 25-task benchmark (requires YAD companion on localhost:3747 + Chrome extension)
pnpm benchmark

# Run authenticated tasks
pnpm benchmark --tasks data/benchmark-tasks-auth.jsonl

# Run extended competitor-coverage tasks
pnpm benchmark --tasks data/benchmark-tasks-extended.jsonl

# Run a single task
pnpm benchmark --id bk-001

# Run with visible browser
pnpm benchmark --headed

# Use a custom model
YAD_MODEL=gpt-4o pnpm benchmark
```

**Scoring**: `pass` (1.0) = agent finished + all expected keywords matched in summary. `partial` (0.5) = agent finished but task has no verifiable keywords. `fail` (0.0) = agent did not complete the task.

### Methodology notes

YAD uses **accessibility tree snapshots** (roles, refs, text) rather than screenshots. This makes it faster and cheaper than vision-based agents, but blind to purely visual structure (canvas, custom dropdowns, icon-only controls). A vision fallback for those cases is a known gap, not yet built.

The agent loop runs a multi-step plan-execute cycle with:
- 5-call same-URL goal-drift guard (with LLM judge check)
- 6-call no-progress guard
- Self-healing recovery loop: 8 stuck signals → LLM generates recovery plan → stored in recovery-store for future runs
- Extract-loop guard: forces finish after 2 consecutive extracts on the same URL (model already has the data)
- 7-day action-cache for zero-LLM-cost replays on repeated tasks

The benchmark measures whether the agent completes the goal and puts the correct data in its finish summary.

Full result files are in `data/benchmark-results-*.json`.

---

## Comparison with other web agents

| Agent | Score | Task count | Technique | Logged-in session? | Cost per task |
|-------|-------|------------|-----------|---------------------|---------------|
| **YAD** | **92% (25 tasks)** | 25 | Accessibility tree | **Yes, user's own Chrome** | Near-zero (cache replay) |
| NanoBrowser | No benchmark published | n/a | Unknown | Yes (extension) | Unknown |
| browser-use | 89.1% (WebVoyager) | 586 | DOM + screenshots | No, fresh browser | API cost per run |
| Skyvern 2.0 | 85.85% (WebVoyager) | 643 | Cloud browser pool | No, cloud browser | Paid cloud |
| WebVoyager (baseline) | 59.1% (WebVoyager) | 643 | GPT-4V + screenshots | No, fresh browser | High (GPT-4V tokens) |

**Key differentiators:**

1. **Persistent logged-in session.** All major competitors (browser-use, Skyvern, WebVoyager) start a fresh browser per task. YAD works inside the user's real Chrome with all cookies and sessions intact. This is the difference between "demo on an empty account" and "real daily automation."

2. **Accessibility tree, not screenshots.** Reading roles and text directly is faster and cheaper than sending images to a vision model. YAD's avg task time is 8.7s vs WebVoyager's minutes per task.

3. **Recovery loop, not yet claimed as full learning.** YAD detects 8 types of stuck signals (goal-drift, consecutive failures, url-regression, etc.), automatically generates an LLM recovery plan in under 3 seconds, and stores successful patterns in a recovery-store for instant reuse on the same site and signal. That is proven recovery, not general-purpose learning across sites, and this README will not claim more than that until it is built.

4. **Near-zero cost on repeated tasks.** The action-cache stores proven action sequences (7-day TTL). Repeated tasks run with 0 LLM calls, returning in about 2 seconds. Cache hit rate grows with usage.

5. **NanoBrowser comparison.** The closest Chrome-extension competitor. As of July 2025, NanoBrowser publishes no benchmark scores. YAD is the only Chrome-extension web agent with an open, reproducible benchmark.

### Benchmark scope note, read this before quoting a number from this README

YAD's 25-task suite is intentionally smaller than WebVoyager's 643-task benchmark, and the two were not run under identical conditions. The tasks cover similar categories (product research, content extraction, web research, news monitoring) on deterministic test sites (books.toscrape.com, quotes.toscrape.com) and live sites (Wikipedia, HackerNews). The static sites ensure reproducibility across runs; the live sites may cause minor variance.

YAD's 92% is not a proven win over browser-use's 89.1%. Different task count, different sites, different scoring harness, no head-to-head run. What the numbers do support: YAD shows strong results on a small, fully reproducible, open benchmark, and it has real architectural advantages for persistent, logged-in browser automation that the other systems structurally do not have (they start a fresh browser per task by design). A direct head-to-head run on the full WebVoyager set is the only thing that would make a real comparison claim, and that has not happened yet.

---

## Install

```bash
pnpm install
```

Yad is a pnpm monorepo. Run this once before [Benchmark](#benchmark) or any of the [Development](#development) commands.

## Security

Full writeup: https://yadagent.com/yad-security

Yad runs local-first: a Chrome extension (the Hand) talks to a Companion app on your own machine (the Brain). Passwords and card numbers never pass through the AI, and the agent is blocked from acting autonomously on payment/checkout pages.

API keys are encrypted at rest with Windows DPAPI, scoped to your Windows user account, the moment you paste them in. The plaintext is discarded after that; decryption only happens in memory during an actual AI call. Keys go straight to your chosen provider (Groq, Gemini, OpenRouter, or a custom endpoint), Yad's developers never see them. The one thing that does phone home is the recovery-store's "recovery brain," and it only sends bare hostnames and reason codes, never keys, page content, or full URLs.

Every AI call passes through a single choke point with a user-configurable daily cap (default 1000 calls) and a one-click stop switch, both fail closed if their saved state is corrupted or missing.

The security code went through an 18-agent adversarial review that found and fixed 12 issues, plus manual testing: 11 payment-page bypass attempts blocked, 5 malicious-link types refused, DNS-rebinding and wire-protocol fuzzing covered.

What this is not: no SOC 2 or ISO 27001 certification, no third-party audit, no paid penetration test. The page says so itself, and avoids claims like "100% secure" or "unhackable."

## Roadmap

Live today: Chrome Web Store and Brave (Brave installs the same Chrome Web Store extension directly). Edge Add-ons is submitted and in review. The website (yadagent.com) is live in English and Dutch, with a security writeup, a blog, and a hosted-teams offering.

Not yet built: Firefox and Safari extensions. The desktop-app is an early, working prototype, not yet packaged for non-technical users.

Open to help with right now: Firefox support (different extension format, not started), macOS support for the Companion (the key-encryption layer uses Windows DPAPI today and would need a Keychain equivalent), and the desktop-app installer (currently requires building from source). See [CONTRIBUTING.md](CONTRIBUTING.md).

This section is kept current, not left on an old milestone.

## Research

A growing list of short technical write-ups on concrete things found while building Yad, real bugs, root causes, and the fixes that came out of them. Nothing linked here yet, the first one is in progress.

## License discipline

MIT/Apache-2.0 dependencies only. No AGPL (no browser-use/Skyvern/BrowserOS as dependency). See `LICENSES.md`. Enforced by `scripts/check-licenses.ts`, run in CI on every push and pull request.

## Development

```
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, package layout, and what's genuinely open to help with right now (Firefox support, macOS support, the desktop-app installer).
</content>
