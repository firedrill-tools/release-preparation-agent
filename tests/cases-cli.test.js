import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { listCases } from "../src/datasets.js";
import { gitEnvironment } from "../src/git-runner.js";
const cli = fileURLToPath(new URL("../scripts/cases.js", import.meta.url));
function call(args, cwd) {
  return JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      cwd,
      env: gitEnvironment(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
for (const p of listCases())
  test(
    `installed private CLI ${p.id} init inspect reset preserve old checkout and fresh UUID`,
    { timeout: 60000 },
    (t) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "release-case-cli-"),
      );
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const root = path.join(directory, "case"),
        first = call(["init", "--repo", root, "--case", p.id], directory),
        file = path.join(root, ".git/firedrill-release/control.json"),
        original = fs.readFileSync(file),
        observed = call(["inspect", "--repo", root], directory),
        fresh = call(
          [
            "reset",
            "--repo",
            root,
            "--destination",
            path.join(directory, "fresh"),
          ],
          directory,
        );
      assert.equal(first.caseId, p.id);
      assert.ok(first.originalSeedMatch);
      assert.equal(observed.instanceId, first.instanceId);
      assert.ok(observed.originalSeedMatch);
      assert.notEqual(fresh.instanceId, first.instanceId);
      assert.equal(fresh.caseId, p.id);
      assert.ok(fresh.originalSeedMatch);
      assert.deepEqual(fs.readFileSync(file), original);
      assert.equal(
        fresh.applicationValid,
        p.expectedControl !== "overflow_preflight",
      );
      assert.equal(
        fresh.runtimeReady,
        !["overflow_preflight", "prepared_preflight"].includes(
          p.expectedControl,
        ),
      );
    },
  );
