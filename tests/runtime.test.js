import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runOwnedAgent } from "../src/runtime.js";
import { environment, rejected } from "./helpers.js";
test(
  "actual owned bundled SDK/native/public hook/inline MCP and parent Git prepare and verify complete local draft",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await runOwnedAgent(e.options),
      receipt = JSON.parse(fs.readFileSync(r.receiptPath));
    assert.equal(e.requests.length, 4);
    assert.equal(receipt.actions.length, 3);
    assert.equal(r.business.appliedDecisionIds.length, 1);
    assert.deepEqual(r.business.preparedDecisionIds, []);
    assert.ok(r.cleanupConfirmed, JSON.stringify(receipt.lifecycle));
    assert.equal(receipt.sdkSubprocessExits[0].code, 0);
    assert.equal(e.control().operations[0].status, "closed");
    assert.ok(receipt.git.length >= 100);
    assert.ok(
      receipt.git.every(
        (c) => c.exitObserved && c.stdout.complete && c.exitCode === 0,
      ),
    );
    assert.ok(
      receipt.calls.every((c) => c.response.events[0].message.unknown_original),
    );
    assert.equal(r.usage.input.value, 40);
    assert.equal(r.costUsd, null);
    assert.ok(!JSON.stringify(receipt).includes("synthetic-release-owned-key"));
    const metadata = JSON.parse(
      fs.readFileSync(path.join(e.root, "release-draft.json"), "utf8"),
    );
    assert.equal(metadata.version, "1.5.0");
    assert.deepEqual(metadata.commitIds, e.intent.commitIds);
    assert.deepEqual(receipt.finalSource.snapshot.business.tags, ["v1.4.0"]);
    assert.deepEqual(
      receipt.finalSource.snapshot.business.refs,
      e.initial.snapshot.business.refs,
    );
    assert.equal(
      receipt.finalSource.snapshot.frame.sha256,
      e.initial.snapshot.frame.sha256,
    );
    const requests = JSON.stringify(e.requests);
    for (const privateValue of [
      e.control().instanceId,
      e.control().operations[0].credentialSha256,
      receipt.outputDir,
    ])
      if (privateValue) assert.ok(!requests.includes(privateValue));
  },
);
for (const kind of ["max-tokens", "missing-stop"])
  test(
    `original ${kind} draft response cannot dispatch through actual SDK to managed source`,
    { timeout: 30000 },
    async (t) => {
      const e = await environment(t, {
          mutate: (frames, n) => {
            if (n === 2) {
              if (kind === "max-tokens")
                frames.find(
                  (f) => f.type === "message_delta",
                ).delta.stop_reason = "max_tokens";
              else frames.pop();
            }
            return frames;
          },
        }),
        r = await rejected(e, undefined, /unfinished|did not complete/);
      assert.equal(e.requests.length, 2);
      assert.equal(r.actions.length, 1);
      assert.equal(r.reportedUsage.input.value, 20);
      assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
      assert.equal(e.control().decisions.length, 0);
      assert.equal(e.control().operations[0].status, "closed");
      assert.ok(
        r.observedBusiness.actualDraftFiles.every((f) => f.kind === "absent"),
      );
    },
  );
test(
  "read-only operation cannot dispatch native draft action",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        { ...e.options, allowWrites: false, intent: undefined },
        /writes_not_authorized/,
      );
    assert.equal(r.actions.length, 1);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.control().decisions.length, 0);
  },
);
test(
  "actual managed backend rejects different valid caller intent despite authorized native args",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        { ...e.options, intent: { ...e.intent, version: "1.6.0" } },
        /writes_not_authorized/,
      );
    assert.equal(r.actions.at(-1).status, "failed");
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.control().decisions.length, 0);
  },
);
test(
  "failed final native completion retains both earlier actual local draft file commits",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (frames, n) => {
          if (n === 4)
            frames.find((f) => f.type === "message_delta").delta.stop_reason =
              "max_tokens";
          return frames;
        },
      }),
      r = await rejected(e, undefined, /unfinished/);
    assert.equal(r.observedBusiness.appliedDecisionIds.length, 1);
    assert.ok(
      r.observedBusiness.actualDraftFiles.every((f) => f.kind === "regular"),
    );
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.control().operations[0].status, "closed");
  },
);
