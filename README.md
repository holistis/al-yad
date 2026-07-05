# Yad (يد) — self-hostable, privacy-first AI browser automation agent

**Yad** ("the hand" in Arabic) is a thin Chrome extension (the Hand) controlled by a locally hosted brain (the Companion). It works inside the user's real, logged-in browser session, learns a task once, and then repeats it deterministically at near-zero cost.

> **Benchmark results** (gpt-4o-mini, July 2025):
> 84% fully correct on 25-task open benchmark · 100% on 5 authenticated tasks · 100% pass+partial · avg 2.7 steps · avg 8.7s per task
> → See [Benchmark](#benchmark) section below.

## Benchmark

YAD includes a fully open, reproducible benchmark suite. Every task definition, scoring script, and result file is checked into this repository — anyone can reproduce the numbers by running `pnpm benchmark`.

### Results (July 2025, gpt-4o-mini via OpenRouter)

| Suite | Tasks | Fully correct | Pass+partial | Avg steps | Avg time |
|-------|-------|---------------|--------------|-----------|----------|
| Main (25 tasks) | product-research, content-extraction, web-research, news-monitoring | **20/25 (80%)** | 25/25 (100%) | 2.9 | 8.0s |
| Auth (5 tasks) | authenticated login + extract | **5/5 (100%)** | 5/5 (100%) | 6.0 | 25.5s |
| **Combined** | **30 tasks** | **25/30 (83%)** | **30/30 (100%)** | — | — |

Results by difficulty (main suite):

| Difficulty | Fully correct | Score |
|------------|---------------|-------|
| Easy (11 tasks) | 9/11 | 90.9% |
| Medium (11 tasks) | 8/11 | 86.4% |
| Hard (3 tasks) | 3/3 | 100% |

### Task categories

- **product-research** (8 tasks) — navigate catalogue, find cheapest/rated item, open product page, read description
- **content-extraction** (7 tasks) — read quotes, list authors, filter by tag, navigate to page 2
- **web-research** (5 tasks) — Wikipedia infobox facts, publication years, geography
- **news-monitoring** (5 tasks) — HackerNews titles, points, most-commented story
- **authenticated** (5 tasks) — full login flow on saucedemo.com, sort, filter, navigate product pages

### How to run

```bash
# Install deps
pnpm install

# Run full 25-task benchmark (requires YAD companion on localhost:3747 + Chrome extension)
pnpm benchmark

# Run authenticated tasks (requires above + saucedemo.com credentials in benchmark task file)
pnpm benchmark --tasks data/benchmark-tasks-auth.jsonl

# Run a single task
pnpm benchmark --id bk-001

# Run with visible browser
pnpm benchmark --headed

# Use a custom model (set env var before running)
YAD_MODEL=gpt-4o pnpm benchmark
```

**Scoring**: `pass` (1.0) = agent finished + all expected keywords matched in summary. `partial` (0.5) = agent finished but task has no verifiable keywords. `fail` (0.0) = agent did not complete the task.

### Methodology notes

YAD uses **accessibility tree snapshots** (roles, refs, text) rather than screenshots. This makes it faster and cheaper than vision-based agents, but blind to purely visual structure.

The agent loop runs a multi-step plan-execute cycle with a 6-AI-call no-progress guard and a 3-call same-URL goal-drift guard. The benchmark measures whether the agent completes the goal and puts the correct data in its finish summary.

Comparison to published benchmarks:
- **WebVoyager** (He et al., 2024): 59.1% on 643 tasks across 15 live websites using GPT-4V + screenshots
- **WebArena** (Zhou et al., 2023): tests on local web-app instances (GitLab, Reddit, etc.)

YAD's benchmark is not directly comparable (different tasks, different sites, smaller scale) but uses similar task types: information extraction, navigation, multi-step form interaction. The static test sites (books.toscrape.com, quotes.toscrape.com) ensure reproducibility across runs; the live sites (Wikipedia, HackerNews) may cause minor variance.

Full result files are in `data/benchmark-results-*.json`.

---

## Architectuur (kort)

- `packages/shared` — gedeelde types/protocol tussen Hand en Brein.
- `packages/companion` — het Brein: native-messaging host, agent-loop, motor (LLM-router), geheugen (action-cache), sleutel (sessie/vault), poort (guardrails).
- `packages/extension` — de Hand: MV3-extensie (WXT), houdt de native-messaging-poort open, voert acties uit.
- `packages/dashboard` — de Winkel: multi-tenant control + billing (latere fase).
- `packages/adapters/REDACTED-session` — brug naar het bestaande `REDACTED` project.

## Status

Fase 1 in opbouw. Eerste mijlpaal (taak nummer 1): de native-messaging handshake tussen Hand en Brein groen op Windows. Daar hangt alles aan.

## Licentie-discipline

Alleen MIT/Apache-2.0 dependencies. Geen AGPL (geen browser-use/Skyvern/BrowserOS als dependency). Zie `LICENSES.md`. CI faalt op overtreding via `scripts/check-licenses.ts`.

## Ontwikkelen

```
pnpm install
pnpm build
pnpm typecheck
pnpm test
```
