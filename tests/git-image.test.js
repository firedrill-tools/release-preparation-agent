import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitImage, writeImage } from "../scripts/git-image.js";
import { initializeControl } from "../src/control.js";
import { withSource } from "./helpers.js";
test(
  "portable original Git object/index image is read and fsck qualified by actual owned Git including merge and annotated base",
  { timeout: 30000 },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "release-git-image-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const g = new GitImage(),
      base = g.commit(
        {
          ".firedrill-release-sample": "synthetic release sample\n",
          "package.json":
            JSON.stringify({
              name: "meridian-portable",
              version: "1.4.0",
              private: true,
            }) + "\n",
          "README.md": "# Explicit fictional author\n",
        },
        "chore: seed 1.4.0",
      );
    g.tag("v1.4.0", base, { annotated: true });
    const main = g.commit(
        { "src/report.js": "export const report = 1;\n" },
        "fix: baseline rounding",
      ),
      side = g.commit(
        { "docs/export.md": "# Café 東京\n" },
        "feat(api)!: change export format\n\nBREAKING CHANGE: full original footer.\n",
        { parents: [base], branch: "export" },
      );
    g.commit(
      { "docs/export.md": "# Café 東京\n" },
      "chore: merge export into release",
      { parents: [main, side] },
    );
    const image = g.image(),
      root = writeImage(path.join(directory, "repository"), image);
    initializeControl(root);
    const s = await withSource(root, (store) => store.capture());
    assert.equal(s.snapshot.business.nextVersion, "2.0.0");
    assert.equal(s.snapshot.business.commits.length, 3);
    assert.equal(s.snapshot.business.commits[0].parents.length, 2);
    assert.match(
      s.snapshot.business.commits.find((c) => c.id === side).message,
      /full original footer/,
    );
    assert.equal(s.snapshot.business.clean, true);
    assert.notEqual(
      s.snapshot.business.baseTagObject,
      s.snapshot.business.baseCommit,
    );
    assert.deepEqual(g.image(), image);
  },
);
