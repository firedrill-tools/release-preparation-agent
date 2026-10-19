/** Fresh locked complete source and production-only CLI/native/Git proof. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "release-distribution-")),
  env = { ...process.env };
for (const k of Object.keys(env))
  if (
    [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_MODEL",
      "CLAUDE_CONFIG_DIR",
      "RELEASE_OPERATION_CREDENTIAL",
      "RELEASE_OPERATION_ID",
      "PORT",
      "NODE_PATH",
      "NODE_OPTIONS",
      "NODE_TEST_CONTEXT",
    ].includes(k) ||
    k.toLowerCase() === "npm_config_allow_scripts"
  )
    delete env[k];
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  run = (cmd, args, cwd = temporary) =>
    execFileSync(cmd, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 900000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
const children = new Set();
let provider;
function within(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
function child(args, extra = {}) {
  const processChild = spawn(process.execPath, args, {
    cwd: temporary,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    err = "";
  processChild.stdout.on("data", (b) => (out += b));
  processChild.stderr.on("data", (b) => (err += b));
  const done = new Promise((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("exit", (code, signal) =>
      resolve({ code, signal, out, err }),
    );
  });
  const entry = { process: processChild, done };
  children.add(entry);
  done.finally(() => children.delete(entry));
  return entry;
}
async function operator(cli, args, extra = {}) {
  const entry = child([cli, ...args], extra);
  return within(entry.done, 20000, "installed operator did not settle");
}
try {
  const source = JSON.parse(
      run(process.execPath, ["scripts/package.mjs"], root),
    ),
    repeat = path.join(temporary, "repeat.tar.gz");
  run(process.execPath, ["scripts/package.mjs", repeat], root);
  assert.deepEqual(fs.readFileSync(source.path), fs.readFileSync(repeat));
  run("tar", ["-xzf", source.path, "-C", temporary]);
  const directory = path.join(temporary, "package"),
    manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "MANIFEST.json")),
    );
  const verify = () => {
    for (const row of manifest.files) {
      const file = path.join(directory, row.path),
        raw = fs.readFileSync(file);
      assert.equal(hash(raw), row.sha256, `delivered hash ${row.path}`);
      assert.equal(raw.length, row.size);
      assert.equal(fs.statSync(file).mode & 0o777, row.mode);
    }
  };
  const enumerated = [];
  function walk(file) {
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory())
      for (const n of fs.readdirSync(file)) walk(path.join(file, n));
    else enumerated.push(path.relative(directory, file));
  }
  walk(directory);
  assert.deepEqual(
    enumerated.sort(),
    [...manifest.files.map((r) => r.path), "MANIFEST.json"].sort(),
  );
  verify();
  run("npm", ["ci", "--no-audit", "--no-fund"], directory);
  if(!fs.existsSync(path.join(directory,'firedrill/scenario.json'))||fs.existsSync(path.join(directory,'firedrill/node_modules')))throw new Error('archive integration boundary differs');
  run('npm',['ci','--prefix','firedrill','--ignore-scripts','--no-audit','--no-fund'],directory);
  run('npm',['test','--prefix','firedrill'],directory);

  const suite = run("npm", ["test"], directory);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/fresh-tests.log"), suite);
  assert.match(suite, /tests\s+130\b/);
  assert.match(suite, /fail\s+0\b/);
  console.log("Fresh locked complete source: 130 checks passed");
  run(process.execPath, ["scripts/build-datasets.js", "--check"], directory);
  const production = path.join(temporary, "production");
  fs.mkdirSync(production);
  for (const name of [
    "src",
    "data",
    "scripts",
    "package.json",
    "package-lock.json",
    "README.md",
    "AGENTS.md",
  ])
    fs.cpSync(path.join(directory, name), path.join(production, name), {
      recursive: true,
    });
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], production);
  const cli = path.join(production, "src/agent.js"),
    casesCli = path.join(production, "scripts/cases.js"),
    inspectCli = path.join(production, "scripts/inspect.js");
  assert.match(run(process.execPath, [cli, "--help"]), /release-preparation/);
  const agentAlias = path.join(temporary, "agent-alias.js"),
    casesAlias = path.join(temporary, "cases-alias.js");
  fs.symlinkSync(cli, agentAlias);
  fs.symlinkSync(casesCli, casesAlias);
  const cases = JSON.parse(run(process.execPath, [casesAlias, "list"]));
  assert.equal(cases.length, 12);
  const roots = new Map();
  function originalTree(root) {
    const files = {};
    function walk(relative) {
      const full = path.join(root, relative),
        stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory())
        for (const n of fs.readdirSync(full).sort())
          walk(relative ? relative + "/" + n : n);
      else
        files[relative] = {
          sha256: hash(fs.readFileSync(full)),
          size: stat.size,
          mode: stat.mode & 0o777,
          ino: stat.ino,
        };
    }
    walk("");
    return files;
  }
  for (const c of cases) {
    const dir = path.join(temporary, c.id),
      first = JSON.parse(
        run(process.execPath, [
          casesAlias,
          "init",
          "--repo",
          dir,
          "--case",
          c.id,
        ]),
      ),
      before = originalTree(dir),
      read = JSON.parse(
        run(process.execPath, [casesCli, "inspect", "--repo", dir]),
      ),
      fresh = JSON.parse(
        run(process.execPath, [
          casesCli,
          "reset",
          "--repo",
          dir,
          "--destination",
          dir + ".fresh",
        ]),
      );
    assert.ok(read.originalSeedMatch);
    assert.ok(fresh.originalSeedMatch);
    assert.equal(
      read.applicationValid,
      c.expectedControl !== "overflow_preflight",
    );
    assert.equal(fresh.applicationValid, read.applicationValid);
    assert.notEqual(first.instanceId, fresh.instanceId);
    assert.deepEqual(originalTree(dir), before);
    roots.set(c.id, dir);
  }
  console.log(
    "Production-only install: all12 private CLI init/inspect/reset paths, including prepared/overflow preflights, preserve old source/mutex/evidence and fresh authority",
  );
  const requests = [];
  let actions;
  const callerIntent = (root) =>
    JSON.parse(
      run(process.execPath, [inspectCli, "--repo", root, "--intent-only"]),
    );
  function chooseScope(root) {
    const intent = callerIntent(root);
    actions = [
      ["mcp__release__inspect_release", {}],
      [
        "mcp__release__prepare_release_draft",
        {
          version: intent.version,
          baseTag: intent.baseTag,
          expectedHead: intent.head,
          commitIds: intent.commitIds,
        },
      ],
      ["mcp__release__read_release_draft", {}],
    ];
    return intent;
  }
  let pendingControl = null,
    faultFinal = false;
  provider = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      requests.push(body);
      assert.equal(req.url, "/v1/messages?beta=true");
      assert.equal(req.headers["x-api-key"], "synthetic-installed-key");
      assert.equal(body.model, "claude-sonnet-4-6");
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.tools.length, 3);
      if (pendingControl) {
        pendingControl.entered();
        await pendingControl.held;
      }
      if (res.destroyed) return;
      const n =
          body.messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .filter((c) => c.type === "tool_result").length + 1,
        action = actions[n - 1],
        events = [
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
                  text: "The complete local release draft was prepared, reread and verified. It was never published.",
                },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: {
              stop_reason:
                faultFinal && n === 4
                  ? "max_tokens"
                  : action
                    ? "tool_use"
                    : "end_turn",
              stop_sequence: null,
            },
            usage: { output_tokens: 2 },
          },
          { type: "message_stop" },
        ];
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "request-id": "request-" + requests.length,
      });
      res.end(
        events
          .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
          .join(""),
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const base = `http://127.0.0.1:${provider.address().port}`,
    common = ["--model", "claude-sonnet-4-6", "--base-url", base],
    rootWorkspace = roots.get("complete-release"),
    intent = chooseScope(rootWorkspace),
    task =
      "Inspect every unreleased commit and policy; prepare only this exact local draft, reread and verify. Never publish.";
  const normal = await operator(
    agentAlias,
    [
      ...common,
      "--repo",
      rootWorkspace,
      "--allow-writes",
      "--intent-json",
      JSON.stringify(intent),
      "--task",
      task,
      "--output",
      path.join(temporary, "normal-receipts"),
    ],
    { ANTHROPIC_API_KEY: "synthetic-installed-key" },
  );
  assert.equal(normal.code, 0, normal.err + normal.out);
  const output = JSON.parse(normal.out),
    trace = JSON.parse(fs.readFileSync(output.receiptPath));
  assert.equal(requests.length, 4);
  assert.equal(output.business.appliedDecisionIds.length, 1);
  assert.equal(output.business.currentDraftVerified, true);
  assert.equal(output.costUsd, null);
  assert.equal(output.usage.input.value, 40);
  assert.ok(trace.cleanupConfirmed);
  assert.equal(trace.actions.length, 3);
  assert.equal(trace.calls.length, 4);
  assert.ok(
    trace.calls.every(
      (c) =>
        c.response.events[0].message.unknown_original &&
        c.reportedUsage.input.value === 10,
    ),
  );
  assert.ok(
    trace.git.every(
      (g) => g.exitObserved && g.exitCode === 0 && g.stdout.complete,
    ),
  );
  assert.equal(trace.sdkSubprocessExits[0].code, 0);
  assert.equal(trace.finalSource.control.operations.at(-1).status, "closed");
  assert.deepEqual(
    trace.finalSource.snapshot.business.refs,
    trace.initialSource.snapshot.business.refs,
  );
  assert.equal(trace.initialAuthority.length, 2);
  assert.ok(!JSON.stringify(trace).includes("synthetic-installed-key"));
  const missing = await operator(cli, [
    ...common,
    "--repo",
    rootWorkspace,
    "--task",
    "Inspect current complete release scope",
    "--output",
    path.join(temporary, "missing-receipts"),
  ]);
  assert.equal(missing.code, 1, missing.err + missing.out);
  const missingOutput = JSON.parse(missing.out);
  assert.ok(missingOutput.cleanupConfirmed);
  assert.equal(missingOutput.usage.input.value, null);
  assert.equal(requests.length, 4);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(missingOutput.outputDir, "trace.json")),
    ).calls.length,
    0,
  );
  for (const osSignal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    let entered, release;
    const pending = new Promise((r) => (entered = r)),
      held = new Promise((r) => (release = r));
    pendingControl = { entered, held };
    const entry = child(
      [
        cli,
        ...common,
        "--repo",
        rootWorkspace,
        "--task",
        "Inspect the complete current release range",
        "--output",
        path.join(temporary, osSignal + "-receipts"),
      ],
      { ANTHROPIC_API_KEY: "synthetic-installed-key" },
    );
    try {
      await within(
        Promise.race([
          pending,
          entry.done.then((r) => {
            throw Error("signal CLI exited early: " + r.out + r.err);
          }),
        ]),
        10000,
        "installed native HTTP not reached",
      );
      entry.process.kill(osSignal);
      const stopped = await within(
        entry.done,
        10000,
        "installed CLI did not drain",
      );
      assert.equal(stopped.code, 1, stopped.err + stopped.out);
      const value = JSON.parse(stopped.out);
      assert.ok(value.cleanupConfirmed);
      assert.match(value.error, new RegExp(osSignal));
      assert.equal(value.usage.input.value, null);
    } finally {
      release();
      pendingControl = null;
    }
  }
  assert.equal(requests.length, 7);
  const current = JSON.parse(
    run(process.execPath, [casesCli, "inspect", "--repo", rootWorkspace]),
  );
  assert.equal(current.privateCurrent.control.decisions.length, 1);
  assert.ok(
    current.privateCurrent.control.operations.every(
      (o) => o.status === "closed",
    ),
  );
  const partialRoot = path.join(temporary, "partial-native");
  run(process.execPath, [
    casesCli,
    "init",
    "--repo",
    partialRoot,
    "--case",
    "complete-release",
  ]);
  const partialIntent = chooseScope(partialRoot);
  faultFinal = true;
  const partial = await operator(
    cli,
    [
      ...common,
      "--repo",
      partialRoot,
      "--allow-writes",
      "--intent-json",
      JSON.stringify(partialIntent),
      "--task",
      task,
      "--output",
      path.join(temporary, "partial-receipts"),
    ],
    { ANTHROPIC_API_KEY: "synthetic-installed-key" },
  );
  assert.equal(partial.code, 1, partial.err + partial.out);
  const value = JSON.parse(partial.out);
  assert.ok(value.cleanupConfirmed);
  assert.match(value.error, /unfinished/);
  assert.equal(value.business.appliedDecisionIds.length, 1);
  assert.ok(value.business.actualDraftFiles.every((f) => f.kind === "regular"));
  assert.equal(value.business.decisions[0].status, "applied");
  assert.equal(value.usage.input.value, 40);
  assert.equal(requests.length, 11);
  console.log(
    "Installed symlink normal CLI/actual Claude SDK/native SSE/public hook/inline MCP/owned Git/exact local draft/read, missing key, all3 signals and committed draft with failed final native completion passed",
  );
  verify();
  const rebuilt = path.join(temporary, "rebuilt.tar.gz");
  run(process.execPath, ["scripts/package.mjs", rebuilt], directory);
  assert.deepEqual(fs.readFileSync(source.path), fs.readFileSync(rebuilt));
  const report = {
    ...source,
    checks:
      "fresh locked complete source and production-only dependencies outside checkout;130real source/managed/Git/SDK/native/public-hook/inline-MCP/CLI/case checks;12private case init/inspect/reset with10actual native paths and2declared preflights;normal installed symlink SDK/native/Git/exact local draft;missing-key prepared evidence;all SIGINT SIGTERM SIGHUP pending HTTP drains;committed draft retained after final native failure;unchanged delivered manifest and repeated portable original source bytes",
  };
  fs.writeFileSync(
    path.join(root, "dist/qualification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  for (const e of children) {
    e.process.kill("SIGKILL");
    await e.done.catch(() => {});
  }
  if (provider) {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
