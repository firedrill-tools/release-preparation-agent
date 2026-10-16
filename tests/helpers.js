import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { seed } from "../scripts/seed.js";
import { GitRunner } from "../src/git-runner.js";
import { ManagedRelease } from "../src/control.js";
import { intentFor } from "../src/snapshot.js";
import { initialize as initializeCase } from "../src/datasets.js";
export async function withSource(root, action) {
  const controller = new AbortController(),
    owner = {
      signal: controller.signal,
      deadline: performance.now() + 20000,
      receipt: { data: { git: [] }, save() {} },
      basicGuard() {
        this.signal.throwIfAborted();
      },
    },
    runner = new GitRunner(root, owner),
    store = new ManagedRelease(root, runner, owner);
  try {
    return await action(store);
  } finally {
    await runner.close();
  }
}
export async function environment(
  t,
  { sequence, mutate = (frames) => frames, caseId, task } = {},
) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "release-owned-runtime-"),
    ),
    root = path.join(directory, "repository"),
    caseSeed = caseId ? await initializeCase(root, caseId) : (seed(root), null),
    initial = caseSeed
      ? caseSeed.source
      : await withSource(root, (s) => s.capture()),
    intent = initial ? intentFor(initial.snapshot.business) : null,
    args = intent
      ? {
          version: intent.version,
          baseTag: intent.baseTag,
          expectedHead: intent.head,
          commitIds: intent.commitIds,
        }
      : null;
  const actions =
      typeof sequence === "function"
        ? sequence({ args, intent, initial })
        : (sequence ?? [
            ["mcp__release__inspect_release", {}],
            ["mcp__release__prepare_release_draft", args],
            ["mcp__release__read_release_draft", {}],
          ]),
    requests = [];
  const provider = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      requests.push(body);
      assert.equal(req.url, "/v1/messages?beta=true");
      assert.equal(req.headers["x-api-key"], "synthetic-release-owned-key");
      assert.equal(body.model, "claude-sonnet-4-6");
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.tools.length, 3);
      const n =
          body.messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .filter((c) => c.type === "tool_result").length + 1,
        action = actions[n - 1],
        frames = [
          {
            type: "message_start",
            message: {
              id: "msg-" + n,
              type: "message",
              role: "assistant",
              model: body.model,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 10 },
              unknown_original: true,
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: action
              ? {
                  type: "tool_use",
                  id: "original-call-" + n,
                  name: action[0],
                  input: {},
                }
              : { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: action
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(action[1]),
                }
              : {
                  type: "text_delta",
                  text: "The complete local release draft was inspected and verified; it was never published.",
                },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: {
              stop_reason: action ? "tool_use" : "end_turn",
              stop_sequence: null,
            },
            usage: { output_tokens: 2 },
          },
          { type: "message_stop" },
        ],
        changed = await mutate(frames, n, {
          root,
          body,
          res,
          intent,
          args,
          initial,
        });
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "request-id": "request-" + n,
      });
      res.end(
        changed
          .map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)
          .join(""),
      );
    } catch (e) {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(async () => {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    root,
    initial,
    intent,
    args,
    requests,
    control: () =>
      JSON.parse(
        fs.readFileSync(
          path.join(root, ".git/firedrill-release/control.json"),
          "utf8",
        ),
      ),
    options: {
      repository: root,
      task:
        task ??
        "Inspect the complete release scope and exact version policy, prepare only the caller-authorized local draft, reread and verify. Never publish.",
      model: "claude-sonnet-4-6",
      apiKey: "synthetic-release-owned-key",
      baseUrl: `http://127.0.0.1:${provider.address().port}`,
      outputRoot: directory,
      allowWrites: intent !== null,
      intent: intent ?? undefined,
    },
  };
}
export async function rejected(e, options = e.options, pattern = /./) {
  let result;
  const { runOwnedAgent } = await import("../src/runtime.js");
  await assert.rejects(runOwnedAgent(options), (error) => {
    assert.match(error.message, pattern);
    result = error.result;
    assert.equal(result.status, "failed");
    return true;
  });
  return result;
}
