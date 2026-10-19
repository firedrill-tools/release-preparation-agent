/** Ten actual SDK/native controls and two explicit zero-request preflights.
 * These authored responses do not assert model semantic quality or paid calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { populations } from "../src/datasets.js";
import { runOwnedAgent } from "../src/runtime.js";
import { environment, rejected } from "./helpers.js";
test(
  "actual native release scope freezes original private seed authority independently of structurally valid current header",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        caseId: "complete-release",
        mutate: (frames, n, { root }) => {
          if (n === 2) {
            const f = path.join(root, ".git/firedrill-release/population.json"),
              header = JSON.parse(fs.readFileSync(f));
            header.createdAt = "2026-10-01T00:00:00.000Z";
            fs.writeFileSync(f, JSON.stringify(header, null, 2) + "\n");
          }
          return frames;
        },
      }),
      r = await rejected(e, undefined, /source authority changed/);
    assert.equal(e.requests.length, 2);
    assert.equal(e.control().decisions.length, 0);
    assert.equal(e.control().operations[0].status, "closed");
    assert.ok(r.cleanupConfirmed);
    assert.equal(r.observedBusiness.finalSourceVerified, false);
    assert.equal(r.initialAuthority.length, 2);
    assert.ok(
      r.initialAuthority.every((f) => f.bodyBase64 && f.sha256 && f.identity),
    );
  },
);
for (const p of populations())
  test(
    `original case ${p.id} through actual normal SDK/native/Git or declared preflight`,
    { timeout: p.id === "busy-merge-release" ? 180000 : 60000 },
    async (t) => {
      const e = await environment(t, {
        caseId: p.id,
        task: p.task,
        sequence: ({ args }) => {
          const proposed = structuredClone(args);
          if (p.assessment.intentFault === "wrong_version")
            proposed.version = "1.4.1";
          if (p.assessment.toolFault === "missing_commit")
            proposed.commitIds = proposed.commitIds.slice(0, -1);
          return [
            ["mcp__release__inspect_release", {}],
            ["mcp__release__prepare_release_draft", proposed],
            ["mcp__release__read_release_draft", {}],
          ];
        },
      });
      if (p.assessment.intentFault === "wrong_version")
        e.options.intent = { ...e.intent, version: "1.4.1" };
      const initialDecisions = e.control().decisions.length;
      if (["applied", "unchanged"].includes(p.assessment.expected)) {
        const r = await runOwnedAgent(e.options),
          receipt = JSON.parse(fs.readFileSync(r.receiptPath));
        assert.equal(e.requests.length, 4);
        assert.ok(r.cleanupConfirmed, JSON.stringify(receipt.lifecycle));
        assert.ok(r.business.currentDraftVerified);
        assert.equal(
          r.business.appliedDecisionIds.length,
          p.assessment.expected === "applied" ? 1 : 0,
        );
        assert.equal(
          r.business.unchangedDecisionIds.length,
          p.assessment.expected === "unchanged" ? 1 : 0,
        );
        assert.equal(r.business.decisions[0].status, p.assessment.expected);
        assert.deepEqual(
          receipt.finalSource.snapshot.business.refs,
          e.initial.snapshot.business.refs,
        );
        assert.equal(
          receipt.finalSource.snapshot.frame.sha256,
          e.initial.snapshot.frame.sha256,
        );
        const context = JSON.stringify(e.requests);
        for (const privateValue of [
          e.control().instanceId,
          e.control().population.definitionSha256,
          "original_explicit_synthetic_git_seed",
          "fictional_imported_release_inspection",
        ])
          assert.ok(!context.includes(privateValue));
      } else {
        const pattern =
          p.assessment.expected === "prepared_preflight"
            ? /prepared_draft_outcome_unresolved/
            : p.assessment.expected === "overflow_preflight"
              ? /version_exhausted/
              : /writes_not_authorized|draft_arguments_differ|dirty_repository|foreign_or_stale_draft/;
        const r = await rejected(e, undefined, pattern);
        assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
        assert.equal(e.control().decisions.length, initialDecisions);
        assert.equal(
          e.requests.length,
          p.assessment.expected.endsWith("preflight") ? 0 : 2,
        );
        if (e.initial)
          assert.deepEqual(
            r.observedBusiness.actualDraftFiles,
            e.initial.draftFiles,
          );
      }
    },
  );
