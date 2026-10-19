# Firedrill agent-first integration

The optional execution toolchain exact-pins released CLI and TypeScript SDK **2.2.2**, verified October 19, 2026. Node 22+ is required. The application retains its separately locked Claude Agent SDK/native HTTP/local MCP runtime.

## Prepare and select scope

From the repository root:

```sh
npm ci
npm ci --prefix firedrill --ignore-scripts --no-audit --no-fund
npm test --prefix firedrill
firedrill_cli=firedrill/node_modules/@firedrill-run/cli/bin/firedrill.mjs
node "$firedrill_cli" validate firedrill/scenario.json --json --non-interactive
```

Validation is offline and allocates no batch. Authorize and select the actual project/environment with `node "$firedrill_cli" init` in a human terminal. Automation uses `FIREDRILL_TOKEN`, `FIREDRILL_PROJECT_ID` and `FIREDRILL_ENVIRONMENT_ID` from its secret store. The application independently requires `ANTHROPIC_API_KEY` and an enabled `CLAUDE_MODEL` or recipe `configuration.parameters.model`. Keep credentials out of recipes and source.

## Execute the actual application

With an authorized provider budget:

```sh
node firedrill/simulate.mjs --preview
node "$firedrill_cli" simulate firedrill/scenario.json --scenario complete-release --json --non-interactive
```

The bounded sequential recipe initializes an actual managed private case and invokes the normal Claude SDK/bundled CLI and narrow local stdio MCP runtime. Starter and blocker tasks are explicitly read-only; the busy case invokes the original model-free case inspector. No injected SDK/child/provider/scripted agent is added. Initialization and private reference/seed/control authority remain outside model context; only existing business tools reach the model. The application's local target MCP is separate from Firedrill's remote OAuth operator MCP.

`allowWrites` is a required literal caller boolean, separate from case/task identity. False requires `intent: null`; true requires an explicit bounded structured caller intent, validated again by the normal application before model work. No intent or grant is derived from fixture task/focus. The recipe grants no writes. For intentional fictional writes, review the exact current source and caller intent through the application's documented preflight before constructing a new recipe. Existing exact identity/evidence/current revision/original source/decision checks remain authoritative. Never blindly retry after uncertainty or repair prepared unknown decisions.

Each invocation first saves outer run/attempt/scenario IDs in private `.runs/firedrill/attempt-*/invocation.json`, then initializes a distinct absent workspace leaf. A new attempt never resets previous files/history/mutex/effects/receipts. Original CLI output and local paths remain actual evidence; failure is nonzero with the original run/workspace locator. Operator/CI credentials are removed before dispatch. Current ID-only invocation excludes controller assessments and rejects unsupported Tool bindings. Retain partial effects and unknown cleanup/source/billing outcomes; local termination does not establish rollback or provider cancellation. Files are local evidence, not uploaded platform artifacts. Release drafts remain local: no tag/push/hosted publication or broad shell tool is granted. Data repair remains within its original narrow CSV/JSON business tools.

## MCP, recovery and CI

Configure remote OAuth operator MCP **https://mcp.firedrill.run/mcp** using the [host-specific setup](https://docs.firedrill.run/guides/coding-agents); no local MCP package is required. Host OAuth and local CLI/SDK login are separate. MCP prepares/queues/inspects; the local execution client runs the actual application. Attach an existing batch with `node firedrill/simulate.mjs --run BATCH_ID`.

Preserve operation IDs and private journals after uncertainty. Recover with `--resume OPERATION_ID` or read retained results with `--result BATCH_ID`. A fresh simulation is new work, and a new adapter invocation gets a fresh synthetic workspace. Runner exit codes preserve pending execution/assessment, errors and optional gates. This observation-only recipe requests no grading or gate.

Ordinary CI and the source-package gate run offline checks, including the actual missing-key boundary and fresh archived integration. Use the [live CI generator](https://docs.firedrill.run/guides/ci) only after actual scope, protected credentials and budgets are configured. Authenticated persisted runs, live model quality/cost, publication and licensing remain separate gates.

References: [SDK](https://docs.firedrill.run/sdk/typescript), [command targets](https://docs.firedrill.run/guides/callbacks), [operator MCP](https://docs.firedrill.run/guides/control-mcp).

Before application dispatch, each private workspace saves the validated outer run/attempt/scenario IDs in `invocation.json`. This maps interrupted runs to local state; it is separate from the SDK recovery journal and grants no application authority.

Private case initialization/inspection uses the actual application dataset functions. Complete original inspection objects are retained as private files outside the model workspace, with byte count and SHA-256 in the returned bounded summary. The 64 MiB retained-file bound is separate from the 4 MiB command-output bound. No source snapshot or oracle is inserted into a model prompt.
