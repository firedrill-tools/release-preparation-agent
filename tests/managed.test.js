import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seed } from "../scripts/seed.js";
import { GitRunner } from "../src/git-runner.js";
import { ManagedRelease, validateControl } from "../src/control.js";
import { intentFor } from "../src/snapshot.js";
import { hash } from "../src/source.js";
async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-managed-")),
    root = seed(path.join(directory, "repository")),
    controller = new AbortController(),
    owner = {
      signal: controller.signal,
      deadline: performance.now() + 30000,
      receipt: { data: { git: [] }, save() {} },
      basicGuard() {
        this.signal.throwIfAborted();
        if (performance.now() >= this.deadline)
          throw Error("operation deadline exceeded");
      },
    },
    runner = new GitRunner(root, owner),
    store = new ManagedRelease(root, runner, owner);
  t.after(async () => {
    if (!runner.closeAttempted) await runner.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const initial = await store.capture();
  return {
    directory,
    root,
    controller,
    owner,
    runner,
    store,
    initial,
    intent: intentFor(initial.snapshot.business),
  };
}
const args = (s) => ({
  version: s.business.nextVersion,
  baseTag: s.business.baseTag,
  expectedHead: s.business.head,
  commitIds: s.business.commits.map((c) => c.id),
});
test("managed seed and original current read bind exact caller scope and durable local draft provenance", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("prepare local draft"), true, e.intent);
  await e.store.inspect(s.credential);
  const result = await e.store.prepare(args(e.initial.snapshot), s.credential);
  assert.equal(result.publicationStatus, "draft");
  assert.equal(result.unchanged, false);
  const control = e.store.readControl().value;
  assert.equal(control.decisions[0].status, "applied");
  assert.equal(control.reads.length, 1);
  assert.equal(control.decisions[0].scope.operationId, s.operation.id);
  assert.equal(fs.statSync(e.store.file).mode & 0o777, 0o600);
  for (const name of ["CHANGELOG.draft.md", "release-draft.json"])
    assert.equal(fs.statSync(path.join(e.root, name)).mode & 0o777, 0o600);
  const read = await e.store.readDraft(s.credential);
  assert.equal(read.metadata.workspaceInstanceId, e.store.instanceId);
  assert.equal(read.metadata.decisionId, result.decisionId);
  assert.deepEqual(read.git.tags, ["v1.4.0"]);
  validateControl(control);
});
test("native write authority cannot exist without genuine inspection and cannot borrow another controller observation", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("draft"), true, e.intent);
  assert.equal(
    (await e.store.prepare(args(e.initial.snapshot), s.credential)).error,
    "genuine_current_inspection_required",
  );
  await e.store.inspect(s.credential);
  const fresh = new ManagedRelease(e.root, e.runner, e.owner);
  assert.equal(
    (await fresh.prepare(args(e.initial.snapshot), s.credential)).error,
    "genuine_current_inspection_required",
  );
  assert.equal(e.store.readControl().value.decisions.length, 0);
});
test("read-only wrong-target and closed scopes cannot create draft files", async (t) => {
  const e = await setup(t),
    readonly = e.store.register(hash("readonly"), false);
  await e.store.inspect(readonly.credential);
  assert.equal(
    (await e.store.prepare(args(e.initial.snapshot), readonly.credential))
      .error,
    "writes_not_authorized",
  );
  const wrong = e.store.register(hash("wrong"), true, {
    ...e.intent,
    repository: "other-project",
  });
  await e.store.inspect(wrong.credential);
  assert.equal(
    (await e.store.prepare(args(e.initial.snapshot), wrong.credential)).error,
    "writes_not_authorized",
  );
  e.store.closeOperation(wrong.credential);
  await assert.rejects(
    e.store.prepare(args(e.initial.snapshot), wrong.credential),
    /operation_closed/,
  );
  assert.equal(fs.existsSync(path.join(e.root, "release-draft.json")), false);
});
test("changes to original Git config or source with unchanged HEAD cannot reuse a caller observation", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("draft"), true, e.intent);
  await e.store.inspect(s.credential);
  fs.appendFileSync(
    path.join(e.root, ".git/info/exclude"),
    "\n# a new local exclusion source\n",
  );
  const result = await e.store.prepare(args(e.initial.snapshot), s.credential);
  assert.equal(result.error, "repository_changed_since_inspection");
  assert.equal(e.store.readControl().value.decisions.length, 0);
  assert.equal(fs.existsSync(path.join(e.root, "CHANGELOG.draft.md")), false);
});
test("fresh read of unchanged genuine draft is an explicit no-op preserving both exact draft files", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("draft"), true, e.intent);
  await e.store.inspect(s.credential);
  await e.store.prepare(args(e.initial.snapshot), s.credential);
  const before = ["CHANGELOG.draft.md", "release-draft.json"].map((n) =>
    fs.readFileSync(path.join(e.root, n)),
  );
  await e.store.inspect(s.credential);
  const result = await e.store.prepare(args(e.initial.snapshot), s.credential);
  assert.equal(result.unchanged, true);
  for (const [n, name] of [
    "CHANGELOG.draft.md",
    "release-draft.json",
  ].entries())
    assert.deepEqual(fs.readFileSync(path.join(e.root, name)), before[n]);
  assert.deepEqual(
    e.store.readControl().value.decisions.map((d) => d.status),
    ["applied", "unchanged"],
  );
});
for (const kind of ["read", "intent", "decision", "bytes"])
  test(`tampered durable ${kind} cannot be accepted as a verified draft`, async (t) => {
    const e = await setup(t),
      s = e.store.register(hash("draft"), true, e.intent);
    await e.store.inspect(s.credential);
    await e.store.prepare(args(e.initial.snapshot), s.credential);
    const c = e.store.readControl().value;
    if (kind === "read") c.reads[0].source.business.repository = "other";
    if (kind === "intent") c.operations[0].intent.version = "999.0.0";
    if (kind === "decision")
      c.decisions[0].readId = "11111111-1111-4111-8111-111111111111";
    if (kind === "bytes")
      c.decisions[0].notesBase64 =
        Buffer.from("other notes").toString("base64");
    fs.writeFileSync(e.store.file, JSON.stringify(c));
    const before = fs.readFileSync(e.store.file);
    assert.throws(() => e.store.readControl());
    assert.deepEqual(fs.readFileSync(e.store.file), before);
  });
test("forged structurally valid draft files cannot replace genuine operation provenance", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("draft"), true, e.intent);
  await e.store.inspect(s.credential);
  await e.store.prepare(args(e.initial.snapshot), s.credential);
  const file = path.join(e.root, "release-draft.json"),
    meta = JSON.parse(fs.readFileSync(file));
  meta.decisionId = "11111111-1111-4111-8111-111111111111";
  fs.writeFileSync(file, JSON.stringify(meta));
  await assert.rejects(e.store.readDraft(s.credential), /unverified/);
});
test("actual file effects survive failed final journal recording as a blocked prepared decision", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("draft"), true, e.intent);
  await e.store.inspect(s.credential);
  const original = e.store.save.bind(e.store);
  e.store.save = (prior, value, guard) => {
    if (value.decisions.at(-1)?.status === "applied")
      throw Error("controlled final release journal failure");
    return original(prior, value, guard);
  };
  await assert.rejects(
    e.store.prepare(args(e.initial.snapshot), s.credential),
    (error) => {
      assert.match(error.message, /journal failure/);
      assert.equal(
        error.partialDraft.actual.filter((f) => f.kind === "regular").length,
        2,
      );
      return true;
    },
  );
  assert.equal(e.store.readControl().value.decisions[0].status, "prepared");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(e.root, "release-draft.json")))
      .publicationStatus,
    "draft",
  );
  assert.throws(() => e.store.register(hash("new"), false), /unresolved/);
  await assert.rejects(e.store.inspect(s.credential), /unresolved/);
  e.store.closeOperation(s.credential);
  assert.equal(e.store.readControl().value.operations[0].status, "closed");
});
test("two observed actors cannot turn one draft into another claimed changed write", async (t) => {
  const e = await setup(t),
    a = e.store.register(hash("first"), true, e.intent),
    b = e.store.register(hash("second"), true, e.intent);
  await e.store.inspect(a.credential);
  await e.store.inspect(b.credential);
  await e.store.prepare(args(e.initial.snapshot), a.credential);
  assert.equal(
    (await e.store.prepare(args(e.initial.snapshot), b.credential)).error,
    "draft_changed_since_inspection",
  );
  assert.equal(e.store.readControl().value.decisions.length, 1);
});
test("replaced control directory cannot redirect a lock or journal write outside the repository", async (t) => {
  const e = await setup(t),
    outside = path.join(e.directory, "outside-control");
  fs.renameSync(e.store.directory, outside);
  fs.symlinkSync(outside, e.store.directory);
  const before = fs.readFileSync(path.join(outside, "control.json"));
  assert.throws(
    () => e.store.register(hash("foreign"), false),
    /directory identity/,
  );
  assert.equal(fs.existsSync(path.join(outside, "lock.sqlite")), false);
  assert.deepEqual(fs.readFileSync(path.join(outside, "control.json")), before);
});
test(
  "six real independent managed processes commit exactly one complete local draft under one durable scope",
  { timeout: 30000 },
  async (t) => {
    const { spawn } = await import("node:child_process"),
      e = await setup(t),
      registration = e.store.register(hash("concurrent draft"), true, e.intent),
      control = new URL("../src/control.js", import.meta.url).href,
      git = new URL("../src/git-runner.js", import.meta.url).href,
      script = `import{ManagedRelease}from ${JSON.stringify(control)};import{GitRunner}from ${JSON.stringify(git)};const controller=new AbortController(),owner={signal:controller.signal,deadline:performance.now()+20000,receipt:{data:{git:[]},save(){}},basicGuard(){this.signal.throwIfAborted();}},runner=new GitRunner(process.argv[1],owner),store=new ManagedRelease(process.argv[1],runner,owner);const s=await store.inspect(process.argv[2]);process.stdout.write('ready\\n');for await(const b of process.stdin){try{const r=await store.prepare({version:s.nextVersion,baseTag:s.baseTag,expectedHead:s.head,commitIds:s.commits.map(c=>c.id)},process.argv[2]);process.stdout.write(JSON.stringify(r));}catch(e){process.stdout.write(JSON.stringify({error:e.message}));}break;}await runner.close();`;
    const entries = Array.from({ length: 6 }, () => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script, e.root, registration.credential],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "",
        ready;
      const prepared = new Promise((resolve, reject) => {
        ready = resolve;
        child.once("error", reject);
        child.once("exit", (code) => {
          if (!out.startsWith("ready\n"))
            reject(Error("worker exited before inspection: " + err));
        });
      });
      child.stdout.on("data", (b) => {
        out += b;
        if (out.startsWith("ready\n")) ready();
      });
      child.stderr.on("data", (b) => (err += b));
      const done = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve(JSON.parse(out.split("\n").slice(1).join("\n")))
            : reject(Error(err)),
        );
      });
      return { child, prepared, done };
    });
    t.after(() => {
      for (const x of entries)
        if (x.child.exitCode === null && x.child.signalCode === null)
          x.child.kill("SIGKILL");
    });
    await Promise.all(entries.map((e) => e.prepared));
    for (const x of entries) x.child.stdin.end("go");
    const results = await Promise.all(entries.map((e) => e.done));
    assert.equal(results.filter((r) => r.metadata && !r.unchanged).length, 1);
    const controlState = e.store.readControl().value;
    assert.equal(controlState.reads.length, 6);
    assert.equal(controlState.decisions.length, 1);
    assert.equal(controlState.decisions[0].status, "applied");
    const draft = await e.store.readDraft(registration.credential);
    assert.equal(draft.metadata.version, "1.5.0");
    assert.equal(fs.statSync(e.store.lock).mode & 0o777, 0o600);
  },
);
test("failure between the two real draft file commits preserves one actual file and prepared evidence", async (t) => {
  const e = await setup(t),
    s = e.store.register(hash("partial two files"), true, e.intent);
  await e.store.inspect(s.credential);
  const guard = e.owner.basicGuard.bind(e.owner);
  e.owner.basicGuard = () => {
    guard();
    if (
      fs.existsSync(path.join(e.root, "CHANGELOG.draft.md")) &&
      !fs.existsSync(path.join(e.root, "release-draft.json"))
    )
      throw Error("controlled interruption between draft files");
  };
  await assert.rejects(
    e.store.prepare(args(e.initial.snapshot), s.credential),
    (error) => {
      assert.match(error.message, /between draft files/);
      assert.equal(error.partialDraft.actual[0].kind, "regular");
      assert.equal(error.partialDraft.actual[1].kind, "absent");
      return true;
    },
  );
  assert.equal(e.store.readControl().value.decisions[0].status, "prepared");
  assert.equal(fs.existsSync(path.join(e.root, "release-draft.json")), false);
  e.store.closeOperation(s.credential);
  assert.equal(e.store.readControl().value.operations[0].status, "closed");
});
