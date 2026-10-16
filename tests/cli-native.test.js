import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { environment } from "./helpers.js";
import { gitEnvironment } from "../src/git-runner.js";
const cli = fileURLToPath(new URL("../src/agent.js", import.meta.url));
function start(e, { permission = true } = {}) {
  const child = spawn(
    process.execPath,
    [
      cli,
      "--repo",
      e.root,
      "--task",
      e.options.task,
      "--model",
      e.options.model,
      "--base-url",
      e.options.baseUrl,
      "--output",
      e.directory,
      ...(permission
        ? ["--allow-writes", "--intent-json", JSON.stringify(e.options.intent)]
        : []),
    ],
    {
      cwd: e.directory,
      env: {
        ...gitEnvironment(),
        ANTHROPIC_API_KEY: "synthetic-release-owned-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (err += b));
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, out, err }));
  });
  return { child, done };
}
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("bounded CLI wait expired")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
test(
  "normal real CLI uses owned actual SDK/native HTTP/inline MCP parent Git and exact durable local draft",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      { child, done } = start(e);
    try {
      const r = await within(done, 20000);
      assert.equal(r.code, 0, r.err + r.out);
      const output = JSON.parse(r.out);
      assert.equal(output.business.appliedDecisionIds.length, 1);
      assert.equal(output.business.currentDraftVerified, true);
      assert.equal(output.usage.input.value, 40);
      assert.equal(output.costUsd, null);
      assert.equal(
        JSON.parse(fs.readFileSync(output.receiptPath)).cleanupConfirmed,
        true,
      );
      assert.equal(e.requests.length, 4);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await done;
    }
  },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  test(
    `normal CLI ${signal} drains actual native HTTP/SDK/Git and closes release authority`,
    { timeout: 30000 },
    async (t) => {
      let entered, release;
      const ready = new Promise((r) => (entered = r)),
        held = new Promise((r) => (release = r)),
        e = await environment(t, {
          mutate: async (frames) => {
            entered();
            await held;
            return frames;
          },
        }),
        { child, done } = start(e, { permission: false });
      try {
        await within(
          Promise.race([
            ready,
            done.then((r) => {
              throw Error("CLI exited before native HTTP: " + r.out + r.err);
            }),
          ]),
          10000,
        );
        child.kill(signal);
        const r = await within(done, 10000);
        assert.equal(r.code, 1, r.err + r.out);
        const output = JSON.parse(r.out);
        assert.equal(output.ok, false);
        assert.match(output.error, new RegExp(signal));
        assert.equal(output.cleanupConfirmed, true);
        assert.equal(output.usage.input.value, null);
        assert.equal(e.control().decisions.length, 0);
        assert.equal(e.control().operations[0].status, "closed");
        assert.equal(e.requests.length, 1);
      } finally {
        release();
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await done;
      }
    },
  );
