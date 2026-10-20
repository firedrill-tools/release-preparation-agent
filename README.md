# Release preparation agent with Claude Agent SDK and MCP

A Claude Agent SDK application prepares release notes and metadata for a fictional disposable Git checkout. Three MCP tools inspect the complete unreleased graph and full messages, prepare the exact policy version, and verify the saved local draft. Tagging, committing, pushing and hosted publication are unavailable to the model.

Simulate this Claude Agent SDK AI agent with [Firedrill](https://firedrill.run/), a simulation platform for AI agents. Start with the [Firedrill setup and simulation guide](firedrill/README.md); your coding agent can operate it while this application's runner stays in your repository or CI.

The managed source, normal native SDK path and twelve private Git cases are implemented. [PLAN.md](PLAN.md) records development and the fresh distribution gate; the [catalog](https://github.com/firedrill-tools/firedrill-example-catalog) records exact qualified revisions and artifact evidence. Live provider/Firedrill/publication gates remain separate.

## Run locally

Requires Node >=22.13, npm and Git. Pinned runtime: Claude Agent SDK0.3.300, MCP2.3.1, Undici7.30.1 and Zod4.6.7.

```sh
npm ci
npm run seed
npm run inspect -- --repo workspace
```

The original fixture has a `v1.4.0` tag, three unreleased commits and policy-derived version `1.5.0`. Seed another fresh directory with `npm run seed -- --dir /path/to/new-disposable-directory`; an existing destination is refused. Each seed receives fresh private managed authority. It has no remote.

Set `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` to an enabled model identifier you have selected. There is no default model or credential. A read-only run:

```sh
npm run operate -- --repo workspace --task 'Inspect the complete unreleased graph, full messages and version policy. Explain the recommended version.'
```

For a local draft, capture the model-free caller intent, review it, then pass both that exact intent and write permission:

```sh
release_intent="$(node scripts/inspect.js --repo workspace --intent-only)"
npm run operate -- --repo workspace --task 'Prepare the complete local release draft from the current source, reread and verify it. Never publish.' --allow-writes --intent-json "$release_intent"
```

Intent binds repository name, derived version, base tag and commit, HEAD and every ordered unreleased commit ID. The runtime still requires a genuine current inspection through its own MCP session. Caller preflight or a previous process cannot authorize that read. Wrong scope/version/range, missing permission, closed authority, changed source, dirty tree or foreign/stale outputs stop preparation. An existing genuine draft requires a fresh read and records an explicit unchanged outcome.

`--model`, `--base-url`, `--output` and `--timeout-ms` override explicit configuration. Provider origin is exact HTTPS, or HTTP on an owned loopback endpoint. `runAgent(options)` in `src/agent.js` exposes the same normal path with `repository`, `task`, `model`, `apiKey`, `baseUrl`, `allowWrites`, `intent`, `outputRoot`, `timeoutMs` and `signal`. SIGINT, SIGTERM and SIGHUP abort the CLI operation and await owned work. Failed runs print structured JSON and exit1, retaining an output directory when receipt preparation succeeded.

## Source, effects and evidence

Stable version policy `stable-conventional-v1` recognizes scoped/case-insensitive features, any declared breaking type/scope and uppercase `BREAKING CHANGE`/`BREAKING-CHANGE` footer. Other subjects default to patch; revert cancellation is not inferred. Only canonical safe stable MAJOR.MINOR.PATCH is supported; prerelease/build versions and overflow reject. Full bounded original messages/parents and actual `rev-list` agreement preserve the complete range. Current tag object/peeled base/ancestor/HEAD/tree/branch/refs, manifest, Git config/index and original regular source bytes are captured. Supported checkouts are exact local managed SHA1 repositories without remotes, nested fallback, shared/shallow/replaced stores, symlinks or included Git configuration.

Preparation records a private durable decision before exclusively creating `CHANGELOG.draft.md` and `release-draft.json` as flushed0600 files. The files and journal are separate commits to disk. Interruption can leave one or both files with a prepared outcome; that state blocks new drafting and does not automatically repair or delete evidence. Original file hashes/source/decision records verify reads. A persistent private SQLite mutex serializes cooperating writers; it is never unlinked during use.

The normal public SDK inline MCP bridge calls the same managed backend directly. The parent owns real Git children through a narrow read-only command catalog, minimal environment, disabled global/system configuration, hooks/fsmonitor and optional index writes. Fixture authoring disables background maintenance. The manual `src/mcp-server.js --repo ROOT [--allow-writes]` stdio seam uses this backend under a declared synthetic-human scope; it is not the normal agent transport.

Private `artifacts/<run-id>/trace.json` is prepared0700/0600 before provider keys or processes. It retains original source/control/draft bytes and hashes, actual Git arguments/PIDs/output/exit observations, original native requests/full SSE/unknown fields/tool IDs/strict arguments/finish reasons/counters, public hook decisions, SDK normalization and cleanup. Original completed native SSE is checked before the actual bundled CLI receives it. Final native text must agree with the drained SDK result. Source/draft changes, errors, unfinished responses, replayed IDs, parallel actions or structured business errors fail without automatic retries. Earlier actual effects remain recorded after later failures. Private controller records, credentials, fixture/reference material and `@file` contents are excluded from the model view; prompts are verbatim, with builtins/settings/session persistence disabled.

The runtime bounds16 prepared native requests/turns,4096 output tokens,256 retained SDK messages,2MiB request/1MiB decoded response,30s native HTTP,120s default shared operation (10..300000ms configurable),512 Git commands,5s/1MiB per command and10s independent final Git observation. It closes durable operation authority before SDK/tool draining and awaits actual child exits, bridge and HTTP cleanup. These are owned process/application controls, not an OS sandbox or remote billing guarantee. Unknown/invalid/observed-zero counters remain distinct. `costUsd` is unknown; `sdkReportedCostUsd` is a separate SDK estimate, never paid billing evidence. Model prose and file existence do not by themselves prove an operation-scoped applied decision or publication.

## Private cases and distribution

`npm run cases -- list` describes all twelve pinned cases. Use `init --repo NEW --case ID`, `inspect --repo ROOT`, or `reset --repo ROOT --destination FRESH` after `npm run cases --`. Reset reconstructs the original case under new private authority and preserves the old checkout/mutex/effects/evidence. Missing/foreign/stripped authority and unknown corruption reject. Prepared and maximum-version cases remain explicit blocked/invalid initial conditions. [data/README.md](data/README.md) describes profiles, full original Git encodings, historical unknowns and ten native versus two zero-request preflight controls.

`npm run check:data` reproduces the original525590bytes. `npm run package:source` creates a complete manifest-bearing portable source archive. `npm run package:check` verifies locked complete and production-only installs outside the checkout, all130checks/all12private case CLI paths, installed normal SDK/native/Git draft/read, missing keys/all signals/final failure after actual files, unchanged delivered source and repeated archive bytes. CI uploads the archive and proof logs; see [COMPATIBILITY.md](COMPATIBILITY.md) for exact pinned seams and evidence limits.

## Verification and remaining external work

`npm test` uses real local Git, real processes, the actual pinned bundled Claude CLI/public hooks/inline MCP and owned loopback HTTP with explicit controlled provider responses. It includes ordinary complete draft/read, incomplete native responses before writes, permission/intent/source/forgery/no-op checks, concurrent writers/runtimes, partial files/journal/receipts, native/source/cleanup failures after actual commits, parent/deadline/CLI signals and literal private-file canaries. These are offline execution and fault controls; they are not live model semantic quality, provider billing or saved Firedrill runs.

Enabled live model credentials/budget and semantic/billing review, authenticated Firedrill scenario/run persistence verification, real repository/account access and publication/license are parked. This private repository has no selected public license. See the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog), [Firedrill](https://firedrill.run/) and [official documentation](https://docs.firedrill.run/) for product context; the current adapter is documented in [firedrill/README.md](firedrill/README.md).

## Current Firedrill integration

Released CLI/SDK 2.2.2, current command invocation, remote operator MCP and recovery are documented in [firedrill/README.md](firedrill/README.md). Offline checks preserve actual managed-source/native key behavior and independent caller intent. Authenticated persisted runs and live quality/cost remain separate parked gates.
