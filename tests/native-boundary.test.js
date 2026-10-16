import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import {
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { Native, configuration } from "../src/native.js";
import { Receipt } from "../src/evidence.js";
import { matchesAction, completedStream } from "../src/native-stream.js";
function stream({
  stop = "end_turn",
  action = false,
  text = "Observed local completion.",
  input = 10,
  output = 2,
  extra = {},
} = {}) {
  const block = action
    ? {
        type: "tool_use",
        id: "original-tool-1",
        name: "mcp__release__inspect_release",
        input: {},
      }
    : { type: "text", text: "" };
  const events = [
    {
      type: "message_start",
      message: {
        id: "original-message",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        usage: { input_tokens: input, cache_read_input_tokens: 0 },
        ...extra,
      },
    },
    { type: "content_block_start", index: 0, content_block: block },
    {
      type: "content_block_delta",
      index: 0,
      delta: action
        ? { type: "input_json_delta", partial_json: "{}" }
        : { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: output },
    },
    { type: "message_stop" },
  ];
  return Buffer.from(
    events
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
  );
}
async function exercise(t, { responses = [stream()], status = 200 } = {}) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "release-native-boundary-"),
    ),
    controller = new AbortController(),
    receipt = new Receipt(directory, { sdk: [], lifecycle: {} }),
    requests = [],
    children = [];
  let toolCalls = 0,
    hookCalls = 0,
    queryObject,
    bridge,
    native;
  const owner = {
    receipt,
    signal: controller.signal,
    deadline: performance.now() + 20000,
    failure: null,
    basicGuard() {
      if (this.failure) throw this.failure;
      this.signal.throwIfAborted();
    },
    async guard() {
      this.basicGuard();
    },
    fail(e) {
      this.failure ??= e;
      controller.abort(e);
    },
  };
  const provider = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const b of req) body += b;
      requests.push({
        url: req.url,
        headers: { key: req.headers["x-api-key"] },
        body: JSON.parse(body),
      });
      res.writeHead(status, {
        "content-type":
          status === 200 ? "text/event-stream" : "application/json",
        "request-id": "original-http-id",
      });
      res.end(responses[Math.min(requests.length - 1, responses.length - 1)]);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  let outcome, error;
  try {
    const config = configuration({
      model: "claude-sonnet-4-6",
      apiKey: "synthetic-owned-upstream",
      baseUrl: `http://127.0.0.1:${provider.address().port}`,
    });
    native = await new Native(config, receipt, owner).open();
    bridge = createSdkMcpServer({
      name: "owned-release",
      version: "1.0.0",
      tools: [
        tool(
          "inspect_release",
          "Inspect the synthetic release source counts",
          {},
          async (args) => {
            assert.ok(
              matchesAction(
                owner.authority,
                "mcp__release__inspect_release",
                args,
              ),
            );
            assert.ok(owner.authority.permission);
            assert.equal(owner.authority.consumed, false);
            owner.authority.consumed = true;
            toolCalls++;
            return {
              content: [
                {
                  type: "text",
                  text: "Actual SDK inline MCP dispatch observed; no business write.",
                },
              ],
            };
          },
        ),
      ],
    });
    const env = Object.fromEntries(
      [
        "PATH",
        "HOME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "SystemRoot",
        "WINDIR",
      ]
        .filter((k) => typeof process.env[k] === "string")
        .map((k) => [k, process.env[k]]),
    );
    Object.assign(env, {
      ANTHROPIC_API_KEY: native.proxyKey,
      ANTHROPIC_BASE_URL: native.origin,
      CLAUDE_CONFIG_DIR: path.join(directory, "claude-config"),
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_AUTOUPDATER: "1",
    });
    queryObject = query({
      prompt:
        "Inspect the synthetic release source, then state the actual observed result.",
      options: {
        model: config.model,
        env,
        cwd: directory,
        abortController: controller,
        maxTurns: 3,
        persistSession: false,
        verbatimPrompts: true,
        settingSources: [],
        tools: [],
        strictMcpConfig: true,
        thinking: { type: "disabled" },
        systemPrompt:
          "Use only the synthetic release source MCP tool. No real provider or business effect is requested.",
        mcpServers: { release: bridge },
        allowedTools: [],
        permissionMode: "default",
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input, id) => {
                  await owner.guard();
                  assert.ok(
                    matchesAction(
                      owner.authority,
                      input.tool_name,
                      input.tool_input,
                      id,
                    ),
                  );
                  owner.authority.permission = true;
                  hookCalls++;
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "allow",
                    },
                  };
                },
              ],
            },
          ],
        },
        canUseTool: async (name, args, extra) => {
          assert.ok(
            matchesAction(owner.authority, name, args, extra.toolUseID),
          );
          return { behavior: "allow", updatedInput: args };
        },
        spawnClaudeCodeProcess: (options) => {
          const child = spawn(options.command, options.args, {
            cwd: options.cwd,
            env: options.env,
            signal: options.signal,
            stdio: ["pipe", "pipe", "pipe"],
          });
          const closed = new Promise((resolve) =>
            child.once("close", (code, signal) => resolve({ code, signal })),
          );
          children.push({ child, closed });
          return child;
        },
      },
    });
    for await (const message of queryObject) {
      receipt.data.sdk.push(message);
      if (message.type === "result") outcome = message;
    }
  } catch (e) {
    error = owner.failure ?? e;
  } finally {
    queryObject?.close();
    for (const child of children) {
      const timer = setTimeout(() => child.child.kill("SIGKILL"), 5000);
      await child.closed;
      clearTimeout(timer);
    }
    await bridge?.instance.close();
    await native?.close();
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  const saved = JSON.parse(fs.readFileSync(receipt.path));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    outcome,
    error,
    requests,
    toolCalls,
    hookCalls,
    saved,
    native,
    children,
    owner,
  };
}
test(
  "actual bundled Claude CLI uses bounded owned HTTP and original completed SSE before an SDK result",
  { timeout: 30000 },
  async (t) => {
    const e = await exercise(t, {
      responses: [stream({ extra: { unknown_original: true } })],
    });
    assert.ifError(e.error);
    assert.equal(e.outcome.subtype, "success");
    assert.equal(e.outcome.result, "Observed local completion.");
    assert.equal(e.requests.length, 1);
    assert.equal(e.requests[0].body.max_tokens, 4096);
    assert.equal(e.requests[0].body.thinking.type, "disabled");
    assert.equal(e.requests[0].headers.key, "synthetic-owned-upstream");
    assert.equal(
      e.saved.calls[0].response.events[0].message.unknown_original,
      true,
    );
    assert.equal(e.saved.calls[0].reportedUsage.input.value, 10);
    assert.equal(e.saved.calls[0].reportedUsage.cachedInput.value, 0);
    assert.equal(e.saved.calls[0].reportedUsage.total.value, null);
    assert.equal(e.native.closed, true);
    assert.equal(e.children.length, 1);
  },
);
test(
  "actual bundled CLI and public PreToolUse hook bind one completed original tool id/name/args before MCP dispatch",
  { timeout: 30000 },
  async (t) => {
    const e = await exercise(t, {
      responses: [stream({ action: true, stop: "tool_use" }), stream()],
    });
    assert.ifError(e.error);
    assert.equal(e.toolCalls, 1);
    assert.equal(e.hookCalls, 1);
    assert.equal(e.requests.length, 2);
    assert.equal(e.saved.calls[0].accepted.id, "original-tool-1");
    assert.equal(e.outcome.result, "Observed local completion.");
  },
);
test(
  "unfinished original native tool SSE is retained but never reaches actual SDK MCP dispatch",
  { timeout: 30000 },
  async (t) => {
    const e = await exercise(t, {
      responses: [stream({ action: true, stop: "max_tokens" })],
    });
    assert.match(e.error.message, /unfinished/);
    assert.equal(e.toolCalls, 0);
    assert.equal(e.hookCalls, 0);
    assert.equal(e.requests.length, 1);
    assert.equal(e.saved.calls[0].status, "failed");
    assert.equal(e.saved.calls[0].reportedUsage.input.value, 10);
    assert.equal(e.saved.calls[0].reportedUsage.output.value, 2);
    assert.equal(e.saved.calls[0].response.complete, true);
    assert.equal(e.native.closed, true);
  },
);
test("original SSE requires message_stop, exact tool JSON and explicit completed finish reason", () => {
  assert.throws(
    () => completedStream(stream({ action: true, stop: "max_tokens" })),
    /unfinished/,
  );
  assert.throws(() => completedStream(stream().subarray(0, -1)), /framing/);
  const duplicate = stream()
    .toString()
    .replace('"input_tokens":10', '"input_tokens":10,"input_tokens":10');
  assert.throws(
    () => completedStream(Buffer.from(duplicate)),
    /duplicate JSON key/,
  );
  assert.throws(() =>
    completedStream(
      Buffer.from(
        stream({ action: true, stop: "tool_use" })
          .toString()
          .replace(
            '"partial_json":"{}"',
            '"partial_json":"{\\"unexpected\\":true}"',
          ),
      ),
    ),
  );
});

test(
  "original missing message_stop is retained but cannot reach the actual SDK tool bridge",
  { timeout: 30000 },
  async (t) => {
    const frames = stream({ action: true, stop: "tool_use" })
      .toString()
      .split("\n\n")
      .filter((f) => !f.includes('"type":"message_stop"'))
      .join("\n\n");
    const e = await exercise(t, { responses: [Buffer.from(frames)] });
    assert.match(e.error.message, /did not complete/);
    assert.equal(e.toolCalls, 0);
    assert.equal(e.hookCalls, 0);
    assert.equal(e.requests.length, 1);
    assert.equal(e.saved.calls[0].reportedUsage.input.value, 10);
    assert.equal(e.native.closed, true);
  },
);
