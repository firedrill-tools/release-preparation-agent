# Release preparation agent

A Claude Agent SDK application inspects a disposable Git repository and prepares local release notes and metadata through a restricted MCP server. The fixture has a `v1.4.0` tag and three unreleased commits. The agent must account for all three, use the policy-derived `1.5.0` version, and stop before any tag, push or hosted release.

## Run locally

Requires Node 22+, npm and Git.

```sh
npm ci
npm run seed
```

Set `ANTHROPIC_API_KEY`, then inspect without writes:

```sh
npm run operate -- --repo workspace --task "Inspect the complete unreleased commit range and recommend the next version"
```

To allow a local draft:

```sh
npm run operate -- --repo workspace --task "Prepare a complete 1.5.0 release draft from v1.4.0 and verify its local files. Do not publish." --allow-writes
```

`CLAUDE_MODEL` selects an enabled Claude model; the default is `claude-sonnet-4-6`. The agent has only the local `inspect_release`, `prepare_release_draft` and `read_release_draft` MCP tools. The MCP server accepts only a repository created by the seed script and never exposes a publication tool. Preparing writes `CHANGELOG.draft.md` and `release-draft.json` in that sample checkout; both remain untracked. It checks a clean tree, expected HEAD, base tag, exact policy version and the complete ordered commit list. A wrong version or omitted commit returns an error without writing. The agent writes `artifacts/<run-id>/result.json` with the answer, SDK cost when available, Git status, tags and remotes.

Seed into another directory with `npm run seed -- --dir /path/to/new-disposable-directory`. The seed command refuses an existing directory. The fixture has no remote. The tool never tags, commits, pushes or creates a GitHub release. This is deliberately a release preparation example, not a publication workflow.

`npm test` exercises real Git history, missing commits, wrong versions, dirty worktrees, read-only MCP rejection and a verified local draft. These are offline Git/MCP checks, not a live Claude run. Live provider and new Firedrill integration proofs remain pending. This private repository has no license pending portfolio publication decisions.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.

## Development audit active

All4 original checks pass, but private actual Git probes found missed scoped/header/footer breaking changes, version overflow, forged published draft metadata accepted on read, a nested marker borrowing parent history, a nonancestor release base and an ignored draft symlink overwriting an unrelated synthetic file. Actual canonical Claude SDK/real stdio/owned loopback SSE also drafts after controlled max_tokens or missing message_stop output and returns success. No production file, paid model or publication was used. [PLAN.md](PLAN.md) records exact private proofs and tasks for complete Git/source/inspection/intent/draft authority, owned Git/native/MCP execution, rich12cases/private CLI and fresh locked distribution. These fixes remain active; external live credentials/new Firedrill/real repositories/publication inputs stay parked.

### First source checkpoint

The18 source/real Git/stdio checks now retain full messages/parents, recognize scoped and footer breaking changes, enforce canonical safe stable versions and explicit fallback policy, reject nonancestor/shared/incomplete/nonlocal repositories, and verify the exact Git root. Bounded Git calls use a minimal environment with global configuration/hooks/fsmonitor/optional index writes disabled. Original duplicate/non-UTF8 source rejects. Draft files use exclusive0600 creation, so an ignored symlink cannot overwrite another file. Strict metadata/note hashes and current source/range checks reject forged published or altered draft content.

Managed durable inspection/intent/operation authorship and prepared multi-file outcome evidence are still pending; current read validates content/context rather than proving the original model wrote it. The old canonical Claude native launch and generic MCP write flag still need the owned completion/lifecycle integration described in PLAN.md. Rich cases/private CLI/distributions follow. This source checkpoint does not complete the project.
