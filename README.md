# Yad (يد) — self-hostable, privacy-first AI browser automation agent

Built by [Abdellah Ouadoudi](https://github.com/holistis)

## Website / homepage / live URL

- **The YAD website (live landing page): https://yadagent.com** — own domain, purchased 2026-08-25, migrated live 2026-08-26. Served from the same server as before (nginx vhost proxies `/` to the `/yad` route on the x402 server). The old https://wazir-x402.duckdns.org/yad URL still works and serves the same content, but yadagent.com is now the canonical one.
- **Chrome Web Store listing** (install page): https://chromewebstore.google.com/detail/dacfhekkemkiikecbjffmbdcohddodea (submitted 2026-08-20, in review — listing itself may still reference the old duckdns URL, not touched during migration to avoid resetting the review).
- Landing page source lives in `site/index.html`; the deployed copy lives at `/app/euler-liquidator/data/yad-landing.html` on the server. nginx config for the domain: `/etc/nginx/sites-available/yadagent` on the Hetzner box.


**Yad** ("the hand" in Arabic) is a thin Chrome extension (the Hand) controlled by a locally hosted brain (the Companion). It works inside the user's real, logged-in browser session, learns a task once, and then repeats it deterministically at near-zero cost.

> **Benchmark results** (gpt-4o-mini, July 2025):
> 92% fully correct on 25-task open benchmark · 100% on 5 authenticated tasks · 100% pass+partial · avg 2.7 steps · avg 8.7s per task
> → See [Benchmark](#benchmark) section below.

## Benchmark

YAD includes a fully open, reproducible benchmark suite. Every task definition, scoring script, and result file is checked into this repository — anyone can reproduce the numbers by running `pnpm benchmark`.

### Results (July 2025, gpt-4o-mini via OpenRouter)

| Suite | Tasks | Fully correct | Pass+partial | Avg steps | Avg time |
|-------|-------|---------------|--------------|-----------|----------|
| Main (25 tasks) | product-research, content-extraction, web-research, news-monitoring | **23/25 (92%)** | 25/25 (100%) | 2.7 | 8.7s |
| Auth (5 tasks) | authenticated login + extract | **5/5 (100%)** | 5/5 (100%) | 6.0 | 25.5s |
| Extended (10 tasks) | academic-research (ArXiv), reference-lookup (Cambridge Dict.), code-research (GitHub) | **10/10 (100%)** | 10/10 (100%) | 1.9 | 8.2s |
| **Combined (all suites)** | **40 tasks** | **38/40 (95%)** | **40/40 (100%)** | — | — |

Results by difficulty (main suite):

| Difficulty | Fully correct | Score |
|------------|---------------|-------|
| Easy (11 tasks) | 10/11 | 91% |
| Medium (11 tasks) | 10/11 | 91% |
| Hard (3 tasks) | 3/3 | 100% |

### Task categories

- **product-research** (8 tasks) — navigate catalogue, find cheapest/rated item, open product page, read description
- **content-extraction** (7 tasks) — read quotes, list authors, filter by tag, navigate to page 2, visit author profile
- **web-research** (5 tasks) — Wikipedia infobox facts, publication years, geography
- **news-monitoring** (5 tasks) — HackerNews titles, points, most-commented story
- **authenticated** (5 tasks) — full login flow on saucedemo.com, sort, filter, navigate product pages
- **academic-research** (5 tasks) — ArXiv paper titles, authors, abstracts
- **reference-lookup** (3 tasks) — Cambridge Dictionary definitions
- **code-research** (2 tasks) — GitHub public repository info

### How to run

```bash
# Install deps
pnpm install

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

YAD uses **accessibility tree snapshots** (roles, refs, text) rather than screenshots. This makes it faster and cheaper than vision-based agents, but blind to purely visual structure.

The agent loop runs a multi-step plan-execute cycle with:
- 5-call same-URL goal-drift guard (with LLM judge check)
- 6-call no-progress guard
- Self-healing recovery loop: 8 stuck signals → LLM generates recovery plan → stored in recovery-store for future runs
- Extract-loop guard: forces finish after 2 consecutive extracts on the same URL (model already has the data)
- 7-day action-cache for zero-LLM-cost replays on repeated tasks

The benchmark measures whether the agent completes the goal and puts the correct data in its finish summary.

---

## Comparison with other web agents

| Agent | Score | Task count | Technique | Logged-in session? | Cost per task |
|-------|-------|------------|-----------|---------------------|---------------|
| **YAD** | **92% (25 tasks)** | 25 | Accessibility tree | **Yes — user's own Chrome** | Near-zero (cache replay) |
| NanoBrowser | No benchmark published | — | Unknown | Yes (extension) | Unknown |
| browser-use | 89.1% (WebVoyager) | 586 | DOM + screenshots | No — fresh browser | API cost per run |
| Skyvern 2.0 | 85.85% (WebVoyager) | 643 | Cloud browser pool | No — cloud browser | Paid cloud |
| WebVoyager (baseline) | 59.1% (WebVoyager) | 643 | GPT-4V + screenshots | No — fresh browser | High (GPT-4V tokens) |

**Key differentiators:**

1. **Persistent logged-in session** — All major competitors (browser-use, Skyvern, WebVoyager) start a fresh browser per task. YAD works inside the user's real Chrome with all cookies and sessions intact. This is the difference between "demo on an empty account" and "real daily automation."

2. **Accessibility tree, not screenshots** — Reading roles and text directly is faster and cheaper than sending images to a vision model. YAD's avg task time is 8.7s vs WebVoyager's minutes per task.

3. **Self-healing learning loop** — YAD detects 8 types of stuck signals (goal-drift, consecutive failures, url-regression, etc.), automatically generates an LLM recovery plan in <3 seconds, and stores successful patterns in a recovery-store for instant reuse. No competitor publishes a comparable system.

4. **Near-zero cost on repeated tasks** — The action-cache stores proven action sequences (7-day TTL). Repeated tasks run with 0 LLM calls, returning in ~2 seconds. Cache hit rate grows with usage.

5. **NanoBrowser comparison** — The closest Chrome-extension competitor. As of July 2025, NanoBrowser publishes no benchmark scores. YAD is the only Chrome-extension web agent with an open, reproducible benchmark.

### Benchmark scope note

YAD's 25-task suite is intentionally smaller than WebVoyager's 643-task benchmark. The tasks cover the same categories (product research, content extraction, web research, news monitoring) on deterministic test sites (books.toscrape.com, quotes.toscrape.com) and live sites (Wikipedia, HackerNews). The static sites ensure reproducibility across runs; the live sites (Wikipedia, HackerNews) may cause minor variance.

For a direct comparison with browser-use and Skyvern on the full WebVoyager benchmark, a larger test run is planned. Current indicators suggest YAD is competitive: our task categories and difficulty levels mirror WebVoyager's, and our 92% score on reproducible tasks exceeds browser-use's 89.1% claim on similar task types.

Full result files are in `data/benchmark-results-*.json`.

---

## Architecture

- `packages/shared` — shared types/protocol between Hand and Brain.
- `packages/companion` — the Brain: native-messaging host, agent-loop, engine (LLM-router), memory (action-cache, recovery-store), key (session/vault), gate (guardrails).
- `packages/extension` — the Hand: MV3 extension (WXT), keeps native-messaging port open, executes actions.
- `packages/dashboard` — v1 orchestrator-UI in front of `main-server.ts`: an in-memory job-queue, worker-pool and a single polling page (single-tenant, no auth/billing yet — multi-tenant control + billing is a later phase, not built).

## Status

Phase 1 in progress. First milestone (task 1): native-messaging handshake between Hand and Brain green on Windows. Everything depends on that.

## License discipline

MIT/Apache-2.0 dependencies only. No AGPL (no browser-use/Skyvern/BrowserOS as dependency). See `LICENSES.md`. CI fails on violation via `scripts/check-licenses.ts`.

## Development

```
pnpm install
pnpm build
pnpm typecheck
pnpm test
```
