import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { datasetBytes } from "../scripts/build-datasets.js";
import { writeImage } from "../scripts/git-image.js";
import { DATASET_SHA256, DATASET_BYTES } from "../src/_dataset-manifest.js";
import { hash } from "../src/source.js";
import { initializeControl } from "../src/control.js";
import { sourceFrame } from "../src/frame.js";
import { withSource } from "./helpers.js";
const raw = fs.readFileSync(
    fileURLToPath(new URL("../data/index.json", import.meta.url)),
  ),
  index = JSON.parse(raw);
test("twelve original portable Git populations repeat exact pinned bytes and declare four profiles and historical unknowns", () => {
  assert.equal(raw.length, DATASET_BYTES);
  assert.equal(hash(raw), DATASET_SHA256);
  assert.deepEqual(datasetBytes(), raw);
  assert.equal(index.cases.length, 12);
  assert.equal(new Set(index.cases.map((c) => c.id)).size, 12);
  assert.equal(new Set(index.cases.map((c) => c.profile)).size, 4);
  for (const p of index.cases) {
    assert.equal(p.history.length, 6);
    assert.equal(p.provenance.priorModelEvidence, null);
    assert.equal(p.provenance.priorHumanAuthentication, null);
    assert.equal(p.provenance.priorPublication, null);
    const known = new Set(p.graph.commits.map((c) => c.id));
    assert.ok(
      p.history.every(
        (h) =>
          known.has(h.head) &&
          h.priorModelEvidence === null &&
          h.priorHumanAuthentication === null,
      ),
    );
  }
});
for (const p of index.cases)
  test(
    `actual owned Git validates original ${p.id} objects complete graph full messages index refs and source bytes`,
    { timeout: 30000 },
    async (t) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "release-population-source-"),
      );
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      for (const [imageName, image] of [
        ["original", p.image],
        ...(p.afterImage ? [["later", p.afterImage]] : []),
      ]) {
        const root = writeImage(path.join(directory, imageName), image);
        initializeControl(root);
        const before = sourceFrame(root);
        if (p.assessment.expected === "overflow_preflight") {
          await assert.rejects(
            withSource(root, (s) => s.capture()),
            /version_exhausted/,
          );
          assert.deepEqual(sourceFrame(root), before);
          continue;
        }
        const observed = await withSource(root, (s) => s.capture()),
          business = observed.snapshot.business,
          commits = new Map(p.graph.commits.map((c) => [c.id, c]));
        assert.equal(
          business.head,
          imageName === "original" ? p.graph.draftHead : p.graph.head,
        );
        assert.equal(business.baseCommit, p.graph.baseCommit);
        assert.equal(business.baseTag, p.graph.baseTag);
        assert.equal(business.tags.length, 3);
        assert.equal(business.clean, p.id !== "dirty-review-note");
        assert.deepEqual(sourceFrame(root), before);
        const reachable = (head) => {
            const ids = new Set();
            function visit(id) {
              if (ids.has(id)) return;
              ids.add(id);
              for (const parent of commits.get(id).parents) visit(parent);
            }
            visit(head);
            return ids;
          },
          excluded = reachable(p.graph.baseCommit),
          expected = [...reachable(business.head)].filter(
            (id) => !excluded.has(id),
          );
        assert.deepEqual(
          new Set(business.commits.map((c) => c.id)),
          new Set(expected),
        );
        for (const c of business.commits) {
          assert.equal(c.message, commits.get(c.id).message);
          assert.deepEqual(c.parents, commits.get(c.id).parents);
        }
        assert.equal(
          business.nextVersion,
          ["scoped-breaking", "footer-breaking"].includes(p.id)
            ? "2.0.0"
            : "1.5.0",
        );
        if (p.id === "busy-merge-release") {
          assert.equal(business.commits.length, 48);
          assert.equal(
            business.commits.filter((c) => c.parents.length === 2).length,
            2,
          );
          assert.ok(business.commits.some((c) => c.message.length > 7000));
          assert.ok(
            business.commits.some((c) =>
              c.message.includes("Café Meridian / 東京"),
            ),
          );
        }
      }
    },
  );
