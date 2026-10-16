# Qualified application boundary

| Dependency | Pinned version | Actual exercised seam |
| --- | --- | --- |
| Node.js | >=22.13 | Files, child processes, AbortSignal and built-in SQLite mutex; local24, CI22 |
| Claude Agent SDK | 0.3.300 | Bundled real CLI through public query/spawnClaudeCodeProcess/PreToolUse/tool/createSdkMcpServer; no replacement child or vendor patch |
| MCP client/server | 2.3.1 | Real manual stdio seam; normal model path is the SDK's inline bridge over the same managed backend |
| Undici | 7.30.1 | Owned original Anthropic HTTP/SSE transport with bounded decoding and explicit origin |
| Zod | 4.6.7 | Strict original arguments, source/control/intent/draft/case schemas |
| Git CLI | System installation | Real narrow read-only commands, original outputs/PIDs/exits, full graph/fsck/ancestor/status/index/ref evidence |

The normal SDK uses an explicit enabled model and key. Controlled loopback fixtures use `claude-sonnet-4-6` only as an explicit test request/response identifier. That does not attest live model availability, semantic quality, costs or billing. Actual live model/provider proof and qualified new Firedrill persisted scenarios remain external gates.

Source audit and normal native lifecycle checkpoints are recorded in PLAN.md, including exact Linux70check CI38956846160 and the real maintenance race correction. The application now has130checks including source/managed/actual Git/process/native SDK/public hook/inline MCP/stdio/normal CLI/private cases. Ten of the twelve population controls make actual bundled SDK/native requests to an owned provider; partial prepared and maximum-version overflow cases reject before any provider request. These are explicit authored responses and faults, not twelve live trials or a substitute agent.

`release-populations`1.0.0 pins525590original bytes, SHA256`0e567a8230cf4795b6d7ef35acea50b18733bd59b4d54ec7d20cc2ba35876edc`. Original Git objects, index, refs and source bytes are delivered directly. Trusted fixture authoring uses deterministic SHA1 Git objects and portable stored-DEFLATE zlib bytes; actual Git validates their integrity and complete graph. There is no dependency on checkout inode/mtime, Git packing or runtime zlib output for source authoring. Current fresh private authority is separately tied to actual directory/file identities. Historical source records are authored fictional records with unknown earlier model/authentication/publication; fresh initialization reads and draft decisions are explicitly synthetic-human actions, never imported model authority.

`npm run package:check` builds a complete manifest-bearing portable USTAR/gzip source archive, installs locked dependencies outside the checkout, runs all130checks and reauthors the exact case source, then installs production-only dependencies and exercises all12private CLI init/inspect/reset paths. It runs the installed normal symlink agent CLI/actual SDK/native/public hook/inline MCP/owned Git draft/read, missing-key evidence, all SIGINT/SIGTERM/SIGHUP pending native HTTP and committed files followed by final native failure. Delivered hashes/sizes/modes and repeated archive bytes must remain identical. CI publishes the original archive, qualification JSON and fresh test log. The catalog records exact qualified commit/run/artifact hashes after downloading and comparing Linux output; this source document does not contain a circular hash of its own archive.

Private controls, receipts, source data and credentials are not public runtime dependencies. No OS sandbox, multi-file atomicity, original human authentication, hosted publication or remote billing guarantee is claimed. No selected public license or Firedrill runtime is bundled.
