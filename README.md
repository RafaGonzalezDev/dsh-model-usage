# dsh-model-usage

A native **DeepSeek Harness** plugin that shows where your tokens went: one calendar heatmap of
daily usage plus a per-model, per-provider breakdown, aggregated from every session in the profile.

| | |
| --- | --- |
| Package | `dsh-model-usage` (this source repository is `dsh-model-usage`) |
| Version | `0.4.4` |
| Harness compatibility | `>=0.2.0-rc.2 <0.3.0-0` |
| License | MIT |

## What it shows

- **A combined annual overview**: the window figures, a rail of the most-used models and a calendar
  of square daily cells filling the available width. Month labels sit above the grid; weekday
  labels are omitted. Hovering a cell opens its day detail on the native elevated `bg-layer-3`
  surface with a dark shadow.
- **Monthly model minicharts**: each model has 12 bars rather than a daily chart.
- **A breakdown grouped by provider**: clicking anywhere on a provider row unfolds the per-model
  split (tokens, requests, share, cache reads and reasoning, last day used). Provider rows have no
  arrow; table rows use lateral padding and rounded bands.
- **A fixed 12-month view (365 days)**, including today in the browser's time zone. There is no
  period selector; the overview and breakdown always describe the same window.
- **Live search above “Modelos más usados”**: typing filters the calendar, models, table and effort
  summary together, matching official name, model ID or provider without case sensitivity. There
  is no “Filtrar actividad” dropdown or provider/model chip selector.
- **Official selector names** from the current DSH model catalog (`LlmModelInfo.name`), with the
  durable model ID as fallback. Provider/model identifiers remain unchanged.
- **Reasoning effort coverage**: logged effort levels and request counts, separate from reasoning
  token counts. Missing effort is unknown, not a default or zero.

The dashboard is a main view: open it from the button at the sidebar foot, right below the ChatGPT
Plan notice when `dsh-chatgpt-plan` is installed, and return to the conversation with **Volver**.

## How it counts

Two durable event types carry provider usage and both are counted:

| Event | Provider and model | Usage |
| --- | --- | --- |
| `assistant/message` | `data.message.source.{provider,model}` | `data.usage` |
| `compaction/summary` | `data.provider`, `data.model` | `data.usage` |

`totalTokens` is `inputTokens + outputTokens`. Cache reads are a subset of the input and reasoning
tokens a subset of the output, so they are reported as their own columns and never added to a
total. Steps that reported no usage still count as requests. `assistant/attempt`, title generation
and web-search request records carry no usage and are ignored.

Effort comes only from the latest `request/header` event's `data.header.config.reasoningEffort`,
when its provider/model matches the assistant message. A new header without effort clears that
attribution. Compaction summaries do not inherit conversation effort. The sum of the effort request
counts is the known coverage; the remaining requests have unknown effort. `reasoningTokens` measures
output tokens instead, and neither field implies the other.

The Remote contract adds optional `series[].name` and
`seriesTotals[].reasoningEfforts: { effort: string; requests: number }[]`. Existing identifiers,
`reasoning` token totals and `reasoningReported` token-coverage counts remain compatible. Names are
current catalog labels, not historical labels; missing catalogs retain model IDs. The Host still
accepts its previous range contract for compatibility, although this dashboard requests only 365 days.

Aggregation is global to the profile: every workspace, every subagent session, every project.
Inherited fork history is counted under the existing per-session rules, not deduplicated across
sessions. Session logs record tokens, never cost, so no monetary figure is shown.

## Install

Build the package and install **the same tarball** in the target profile through Harness's native
plugin manager. Keep the previous working tarball for rollback.

```sh
nvm use
npm ci
npm run check
npm run pack:plugin
```

The commands above emit `dsh-model-usage-<version>.tgz` in the repository root.

**Windows Desktop**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\path\to\dsh-model-usage-0.4.4.tgz"
```

**macOS Desktop and local Web**

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/dsh-model-usage-0.4.4.tgz
dsh plugin --profile web add /absolute/path/dsh-model-usage-0.4.4.tgz
```

The `desktop` profile is managed by the Electron application, so it is reloaded with the
application's **restartHost** action; refresh the existing UI afterwards. Source edits alone never
change an installed profile.

## Where the numbers come from

The Host folds the durable session logs the Harness already writes and caches the result per
session under `<profile>/.cache/dsh-model-usage/usage-v1.json`. This version uses cache schema **3**;
the filename is unchanged. An older cache is automatically discarded and rebuilt from session logs
after the updated Host loads. Unchanged persisted sessions reuse their cached contribution; live
sessions without a persistence signature are re-read. Model names are fetched from the current
catalog for each snapshot and are not persisted in this cache.

For an upgrade, rebuild the Host, generated Remote contract and Client, install the updated tarball,
then restart the Host and refresh the existing UI. A browser refresh alone cannot activate the new
Host fields or cache schema.

`npm run verify:usage` recounts every persisted log independently and compares the result with that
cache:

```sh
npm run verify:usage
npm run verify:usage -- --cache "C:\Users\you\.dsh\profiles\desktop\.cache\dsh-model-usage\usage-v1.json"
```

Live sessions and activity persisted after the last scan can produce differences in either
direction. Compare a refreshed cache and persisted logs against an idle profile before diagnosing
a counting error.

## Development

```sh
nvm use
npm ci
npm run check          # build Host, generated RPC and Client, then run the suite
npm run typecheck      # static types
npm run pack:plugin    # emit the installable tarball in the repository root
```

The suite runs on Node's own type stripping, without a loader, so it needs no build step and no
child process. React views are exercised through their pure derivation and in the live UI; the Node
runner cannot parse `.tsx`.

## Documentation

Everything a reviewer needs lives in this README and in the source. The panel copy itself ships in
Spanish.

## License

MIT. Third-party notices are reproduced in
[THIRD_PARTY_NOTICES.md](<packages/plugin/THIRD_PARTY_NOTICES.md>).
