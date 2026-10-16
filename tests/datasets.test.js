import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  populations,
  listCases,
  initialize,
  inspect,
  reset,
} from "../src/datasets.js";
import { withSource } from "./helpers.js";
import { DATASET_SHA256 } from "../src/_dataset-manifest.js";
function directory(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "release-private-case-"));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
for (const p of populations())
  test(
    `private ${p.id} init inspect reset retain original seed and fresh isolated authority`,
    { timeout: 30000 },
    async (t) => {
      const d = directory(t),
        root = path.join(d, "case"),
        first = await initialize(root, p.id),
        control = path.join(root, ".git/firedrill-release/control.json"),
        lock = path.join(root, ".git/firedrill-release/lock.sqlite"),
        originalControl = fs.readFileSync(control),
        originalLock = fs.existsSync(lock) ? fs.statSync(lock).ino : null;
      assert.equal(first.caseId, p.id);
      assert.equal(first.datasetSha256, DATASET_SHA256);
      assert.ok(first.originalSeedMatch);
      assert.equal(
        first.applicationValid,
        p.assessment.expected !== "overflow_preflight",
      );
      assert.equal(
        first.runtimeReady,
        !["overflow_preflight", "prepared_preflight"].includes(
          p.assessment.expected,
        ),
      );
      assert.equal(first.privateCurrent.control.reads.length, p.setup.reads);
      assert.equal(first.privateCurrent.control.operations.length, 0);
      assert.ok(
        first.privateCurrent.control.reads.every(
          (r) =>
            r.scope.kind === "synthetic_human" &&
            r.instanceId === first.instanceId,
        ),
      );
      const observed = await inspect(root);
      assert.ok(observed.originalSeedMatch);
      assert.equal(observed.instanceId, first.instanceId);
      assert.deepEqual(fs.readFileSync(control), originalControl);
      const fresh = await reset(root, path.join(d, "fresh"));
      assert.notEqual(fresh.instanceId, first.instanceId);
      assert.notEqual(
        fresh.privateCurrent.frame.rootIdentity,
        first.privateCurrent.frame.rootIdentity,
      );
      assert.ok(fresh.originalSeedMatch);
      assert.equal(fresh.caseId, p.id);
      assert.deepEqual(fs.readFileSync(control), originalControl);
      if (originalLock !== null)
        assert.equal(fs.statSync(lock).ino, originalLock);
      await assert.rejects(initialize(root, p.id), /EEXIST/);
      await assert.rejects(reset(root, root), /distinct/);
      await assert.rejects(reset(root, path.join(d, "fresh")), /EEXIST/);
      assert.equal(fs.statSync(control).mode & 0o777, 0o600);
      assert.equal(
        fs.statSync(path.join(root, ".git/firedrill-release/population.json"))
          .mode & 0o777,
        0o600,
      );
    },
  );
test("private case catalog has complete profiles and busy graph scale without attesting historical model executions", () => {
  const rows = listCases();
  assert.equal(rows.length, 12);
  const busy = rows.find((p) => p.profile === "busy");
  assert.equal(busy.commits, 51);
  assert.equal(busy.branches, 3);
  assert.equal(busy.tags, 3);
  assert.equal(busy.historicalSourceRecords, 6);
  assert.equal(busy.freshSyntheticAuthorReads, 6);
});
for (const mode of [
  "missing-header",
  "tampered-header",
  "changed-seed",
  "stripped-reference",
])
  test(
    `normal managed source and private reset reject ${mode} original authority`,
    { timeout: 30000 },
    async (t) => {
      const d = directory(t),
        root = path.join(d, "case");
      await initialize(root);
      const control = path.join(root, ".git/firedrill-release"),
        header = path.join(control, "population.json"),
        seed = path.join(control, "population-seed.json");
      if (mode === "missing-header") fs.unlinkSync(header);
      else if (mode === "tampered-header") {
        const value = JSON.parse(fs.readFileSync(header));
        value.instanceId = "00000000-0000-4000-8000-000000000001";
        fs.writeFileSync(header, JSON.stringify(value));
      } else if (mode === "changed-seed") fs.appendFileSync(seed, "\n");
      else {
        const file = path.join(control, "control.json"),
          value = JSON.parse(fs.readFileSync(file));
        value.population = null;
        fs.writeFileSync(file, JSON.stringify(value));
      }
      await assert.rejects(withSource(root, (s) => s.capture()));
      await assert.rejects(reset(root, path.join(d, "fresh")));
      assert.equal(fs.existsSync(path.join(d, "fresh")), false);
    },
  );
test(
  "unrecognized current corrupt source cannot be reset into an apparently healthy case",
  { timeout: 30000 },
  async (t) => {
    const d = directory(t),
      root = path.join(d, "case");
    await initialize(root);
    fs.writeFileSync(path.join(root, "package.json"), "{broken");
    const state = await inspect(root);
    assert.equal(state.applicationValid, false);
    assert.equal(state.originalSeedMatch, false);
    assert.ok(state.applicationError);
    await assert.rejects(
      reset(root, path.join(d, "fresh")),
      /unrecognized corrupt/,
    );
    assert.equal(fs.existsSync(path.join(d, "fresh")), false);
    assert.equal(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
      "{broken",
    );
  },
);
test(
  "valid current local draft differs from original seed and reset preserves old effects while restoring fresh original case",
  { timeout: 30000 },
  async (t) => {
    const d = directory(t),
      root = path.join(d, "case");
    await initialize(root);
    const result = await withSource(root, async (store) => {
      const s = await store.inspect();
      return store.prepare({
        version: s.nextVersion,
        baseTag: s.baseTag,
        expectedHead: s.head,
        commitIds: s.commits.map((c) => c.id),
      });
    });
    assert.equal(result.unchanged, false);
    const current = await inspect(root),
      notes = fs.readFileSync(path.join(root, "CHANGELOG.draft.md"));
    assert.equal(current.originalSeedMatch, false);
    assert.equal(current.source.sourceClean, true);
    const fresh = await reset(root, path.join(d, "fresh"));
    assert.ok(
      fresh.privateCurrent.draftFiles.every((f) => f.kind === "absent"),
    );
    assert.ok(fresh.originalSeedMatch);
    assert.deepEqual(
      fs.readFileSync(path.join(root, "CHANGELOG.draft.md")),
      notes,
    );
  },
);
test(
  "copied original case cannot borrow another directory instance authority",
  { timeout: 30000 },
  async (t) => {
    const d = directory(t),
      root = path.join(d, "case"),
      copy = path.join(d, "copy");
    await initialize(root);
    fs.cpSync(root, copy, { recursive: true });
    await assert.rejects(inspect(copy), /instance\/root changed/);
    await assert.rejects(reset(copy, path.join(d, "fresh")));
    assert.equal(fs.existsSync(path.join(d, "fresh")), false);
  },
);
test(
  "unknown case or cancelled private initialization does not create a destination",
  { timeout: 30000 },
  async (t) => {
    const d = directory(t),
      root = path.join(d, "case");
    await assert.rejects(initialize(root, "unknown"), /unknown release case/);
    assert.equal(fs.existsSync(root), false);
    const controller = new AbortController();
    controller.abort(Error("controlled private cancel"));
    await assert.rejects(
      initialize(root, "complete-release", { signal: controller.signal }),
      /private cancel/,
    );
    assert.equal(fs.existsSync(root), false);
  },
);
