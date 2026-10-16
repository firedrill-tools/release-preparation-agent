import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { seed } from "../scripts/seed.js";
import { GitRunner, gitArguments } from "../src/git-runner.js";
import { inspectSnapshot, validateSnapshot } from "../src/snapshot.js";
function setup(t) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "release-git-owned-"),
    ),
    root = seed(path.join(directory, "repository")),
    controller = new AbortController(),
    receipt = { data: { git: [] }, save() {} },
    owner = {
      receipt,
      signal: controller.signal,
      deadline: performance.now() + 20000,
      basicGuard() {
        this.signal.throwIfAborted();
        if (performance.now() >= this.deadline)
          throw Error("operation deadline exceeded");
      },
    },
    runner = new GitRunner(root, owner);
  t.after(async () => {
    if (!runner.closeAttempted) await runner.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, root, controller, owner, runner };
}
test("owned real Git inspection retains original command bytes/full graph and immutable complete source image", async (t) => {
  const e = setup(t),
    s = await inspectSnapshot(e.root, e.runner);
  assert.equal(s.business.nextVersion, "1.5.0");
  assert.equal(s.business.commits.length, 3);
  assert.equal(s.business.clean, true);
  assert.equal(e.owner.receipt.data.git.length, 16);
  assert.ok(
    e.owner.receipt.data.git.every(
      (c) => c.exitObserved && c.exitCode === 0 && c.stdout.complete,
    ),
  );
  validateSnapshot(s);
  const bad = structuredClone(s);
  bad.business.commits[0].message = "Other source";
  assert.throws(() => validateSnapshot(bad));
  await e.runner.close();
  assert.equal(e.runner.closed, true);
});
test("actual cat-file child pending on owned stdin is cancelled and its real exit awaited", async (t) => {
  const e = setup(t),
    input = new PassThrough(),
    work = e.runner.run("batchObjects", [], { input });
  void work.catch(() => {});
  assert.ok(e.runner.children[0].record.pid > 0);
  e.controller.abort(Error("controlled parent cancellation"));
  await assert.rejects(work, /parent cancellation/);
  await e.runner.close();
  assert.ok(e.runner.children.every((c) => c.record.exitObserved));
  assert.equal(e.owner.receipt.data.git[0].stdout.complete, false);
  assert.equal(e.owner.receipt.data.git[0].stdout.sha256, null);
  input.destroy();
});
test("actual pending Git child obeys remaining shared deadline", async (t) => {
  const e = setup(t),
    input = new PassThrough();
  e.owner.deadline = performance.now() + 100;
  await assert.rejects(e.runner.run("batchObjects", [], { input }), /deadline/);
  assert.ok(e.runner.children[0].record.exitObserved);
  await e.runner.close();
  input.destroy();
});
test("narrow read-only Git catalog cannot tag publish invoke shell or add dynamic command flags", () => {
  for (const key of ["push", "commit", "tag", "shell"])
    assert.throws(() => gitArguments(key));
  assert.throws(() => gitArguments("tags", ["--delete"]));
  assert.throws(() => gitArguments("log", ["--all"]));
  assert.throws(() => gitArguments("base", ["--exec=command"]));
});
