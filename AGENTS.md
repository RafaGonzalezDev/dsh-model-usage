# AGENTS.md

Guidance for coding agents working in this repository. It complements [README.md](README.md); it
does not replace it.

## Project identity

- The repository `dsh-model-usage` publishes the package **`dsh-model-usage`**, a DeepSeek Harness
  plugin with one Host service and one Client dashboard.
- Version source of truth: [packages/plugin/package.json](packages/plugin/package.json). The
  workspace root `package.json` mirrors it.
- The plugin is **read-only**: it folds the durable session logs the Harness already writes and
  serves an aggregate over the Remote contract. It never writes session data and never calls a
  provider.
- The panel copy ships in English, like the rest of the Harness UI. Repository documentation and
  identifiers stay in English.

## Invariants

Do not change these without an explicit request and a recorded decision:

- **Only two event types carry usage**: `assistant/message`
  (`data.message.source.{provider,model}` with `data.usage`) and `compaction/summary`
  (`data.provider`, `data.model`, `data.usage`). `assistant/attempt`, title generation and
  web-search request records are ignored by design.
- **A record's total is the sum of four disjoint components**: uncached input, output, cache reads
  and cache writes. Reasoning tokens are a subset of the output and are never added again. Adapters
  differ: an OpenAI-compatible one reports the uncached prompt and totals `input + output + cache`,
  while the ChatGPT-plan one reports a prompt that already contains the cache and totals
  `input + output`. Each record is reconciled against its own `totalTokens`, so `input` always means
  *uncached* prompt and the four components always add up to the provider total.
- **Missing effort is unknown**, never a default and never zero. Effort comes only from the latest
  `request/header` event whose provider/model matches the assistant message; a new header without
  effort clears the attribution, and compaction summaries never inherit conversation effort.
- **Aggregation is global to the profile**: every workspace, subagent session and project. Inherited
  fork history is counted under the existing per-session rules, not deduplicated.
- **No monetary figure is shown.** Session logs record tokens, never cost.
- **Model names are current catalog labels**, resolved per snapshot; the durable model ID is the
  fallback and the only persisted identity.
- Steps that reported no usage still count as requests.

## Layout

| Path | Contents |
| --- | --- |
| [packages/plugin/src/fold.ts](packages/plugin/src/fold.ts) | Event-to-usage folding and series identity. |
| [packages/plugin/src/aggregator.ts](packages/plugin/src/aggregator.ts) | Corpus scan, per-session signatures and the snapshot cache. |
| [packages/plugin/src/cache.ts](packages/plugin/src/cache.ts) | Atomic per-session cache store. |
| [packages/plugin/src/calendar.ts](packages/plugin/src/calendar.ts) | Day bucketing and window construction. |
| [packages/plugin/src/contracts.ts](packages/plugin/src/contracts.ts) | Public, token-free Host/Client contracts. |
| [packages/plugin/src/service.ts](packages/plugin/src/service.ts) | `ctx.remote.modelUsage.snapshot` Host service. |
| [packages/plugin/src/index.ts](packages/plugin/src/index.ts) | Plugin wiring: first scan delay and rescan after a flush. |
| [packages/plugin/src/client](packages/plugin/src/client/) | Dashboard views, pure derivation, formatting and styles. |
| [scripts/verify-usage.ts](scripts/verify-usage.ts) | Independent recount of persisted logs against the cache. |
| [test](test/) | Folding, caching, aggregation, calendar and dashboard tests. |
| [docs](docs/) | The [agent installation runbook](docs/agent-install.md). |

## Commands

Run from the repository root, with Node 24 (`nvm use`, see [.nvmrc](.nvmrc)).

```sh
npm ci
npm run check          # build Host, generated RPC and Client, then run the test suite
npm run typecheck      # builds the Host first, then checks both TypeScript projects
npm run pack:plugin    # emit dsh-model-usage-<version>.tgz in the repository root
npm run verify:usage   # recount persisted logs and compare with the cache
npm run verify:usage -- --cache "<path to usage-v1.json>"
```

Runner specifics:

- `test` is `node --test --test-isolation=none test/*.test.ts`, using Node's own type stripping: no
  loader and no build step. The Node runner cannot parse `.tsx`, so React views are exercised through
  their pure derivation ([client/derive.ts](packages/plugin/src/client/derive.ts)) and in the live UI.
- `typecheck` runs `build:host` first because the generated Remote types must exist.
- `lib/`, `packages/.build/` and `*.tsbuildinfo` are generated and ignored. Never edit them.

## Contracts and cache

- `UsageQuery`, `UsageSnapshot`, `UsageSeries`, `UsageCell` and `UsageSeriesTotals` in
  [contracts.ts](packages/plugin/src/contracts.ts) are the Host/Client boundary. Keep new fields
  optional and keep the Host accepting the previous range contract.
- The cache lives at `<profile>/.cache/dsh-model-usage/usage-v1.json` and uses **schema 4**. The
  filename does not change with the schema: an older cache is discarded and rebuilt from session
  logs after the updated Host loads, because schema 3 never stored cache writes.
- Changing the persisted shape requires bumping the schema. Changing what is counted requires
  updating the **How it counts** section of [README.md](README.md) and the tests that assert it.
- Live sessions and activity persisted after the last scan legitimately differ from the cache;
  compare a refreshed cache against an idle profile before diagnosing a counting bug.

## Dependency and build policy

- DSH peers, `engines.dsh` and the tested baseline follow the same bounded range as the other
  plugins in this workspace: `>=0.2.0-rc.2 <0.3.0-0`, with development dependencies pinned to
  `0.2.0-rc.2`. Do not widen the range silently.
- `zod` is the only runtime dependency. React and the Harness UI packages stay external peers and
  are never bundled into the Client; `zod` and the generated Remote client are the only bundled
  modules, as declared in the Client bundler configuration.
- Keep the lockfile; do not add dependencies for something the standard library or an existing
  module already does.

## Git and documentation conventions

- When commits are explicitly requested, use English Conventional Commit subjects matching the
  history: `feat(plugin):`, `feat(client):`, `refactor(client):`, `test:`, `docs:`, `chore(scripts):`,
  `build(plugin):`, `chore(release):`.
- Keep independently meaningful changes in separate commits. Do not commit unless asked.
- Deployment evidence belongs in a `*.local.md` file, which is git-ignored. Never commit tokens,
  account identifiers, session logs or machine-specific paths.

## Do not

- Do not add provider calls, telemetry or any outbound network request; the plugin only reads local
  session logs and the in-process model catalog.
- Do not edit an installed Harness profile, its `node_modules`, the application ASAR/core, or a
  Pi/WSL installation. Source edits never change an installed profile.
- Do not start a replacement Web server or claim hot-reload. Install through the bundled CLI and use
  the application's **restartHost** action; see the
  [agent installation runbook](docs/agent-install.md).
