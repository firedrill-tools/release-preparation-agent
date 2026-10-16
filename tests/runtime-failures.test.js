import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runOwnedAgent } from "../src/runtime.js";
import { environment, rejected } from "./helpers.js";
import { ManagedRelease } from "../src/control.js";
import { GitRunner } from "../src/git-runner.js";
import { Native } from "../src/native.js";
import { PassThrough } from "node:stream";
for (const mode of ["between-files", "final-journal"])
  test(
    `actual SDK draft ${mode} failure preserves prepared decision and actual separate file effects`,
    { timeout: 30000 },
    async (t) => {
      const e = await environment(t),
        originalPrepare = ManagedRelease.prototype.prepare,
        originalSave = ManagedRelease.prototype.save;
      if (mode === "between-files")
        ManagedRelease.prototype.prepare = async function (...args) {
          const guard = this.owner.basicGuard.bind(this.owner);
          this.owner.basicGuard = () => {
            guard();
            if (
              fs.existsSync(path.join(this.root, "CHANGELOG.draft.md")) &&
              !fs.existsSync(path.join(this.root, "release-draft.json"))
            )
              throw Error("controlled between-files interruption");
          };
          try {
            return await originalPrepare.apply(this, args);
          } finally {
            this.owner.basicGuard = guard;
          }
        };
      else
        ManagedRelease.prototype.save = function (prior, value, ...rest) {
          if (value.decisions.some((d) => d.status === "applied"))
            throw Error("controlled final-journal failure");
          return originalSave.call(this, prior, value, ...rest);
        };
      try {
        const r = await rejected(e, undefined, /between-files|final-journal/);
        assert.equal(e.requests.length, 2);
        assert.equal(e.control().operations[0].status, "closed");
        assert.equal(e.control().decisions[0].status, "prepared");
        assert.equal(r.observedBusiness.preparedDecisionIds.length, 1);
        assert.equal(r.observedBusiness.appliedDecisionIds.length, 0);
        assert.deepEqual(
          r.observedBusiness.actualDraftFiles.map((f) => f.kind),
          ["regular", mode === "between-files" ? "absent" : "regular"],
        );
        assert.ok(r.actions.at(-1).partialDraft);
        assert.ok(r.cleanupConfirmed);
      } finally {
        ManagedRelease.prototype.prepare = originalPrepare;
        ManagedRelease.prototype.save = originalSave;
      }
    },
  );
test(
  "unchanged HEAD with later original Git exclude change rejects native draft authority",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (frames, n, { root }) => {
          if (n === 2)
            fs.appendFileSync(
              path.join(root, ".git/info/exclude"),
              "\nUnrelated-private-file\n",
            );
          return frames;
        },
      }),
      r = await rejected(e, undefined, /source changed/);
    assert.equal(e.control().decisions.length, 0);
    assert.equal(r.observedBusiness.appliedDecisionIds.length, 0);
    assert.ok(r.cleanupConfirmed);
    assert.ok(
      r.observedBusiness.actualDraftFiles.every((f) => f.kind === "absent"),
    );
  },
);
test(
  "missing key prepares failed private receipt before Git SDK or native HTTP allocation",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(e, { ...e.options, apiKey: "" }, /ANTHROPIC_API_KEY/);
    assert.equal(e.requests.length, 0);
    assert.equal(r.lifecycle.gitAllocated, false);
    assert.equal(r.lifecycle.sdkAllocated, false);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.control().operations.length, 0);
  },
);
test(
  "SDK replacement injection is rejected before resource allocation",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        { ...e.options, spawnClaudeCodeProcess: () => {} },
        /injected/,
      );
    assert.equal(r.git.length, 0);
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.control().operations.length, 0);
  },
);
test(
  "pending native draft response parent cancellation closes durable authority and drains actual SDK HTTP and Git",
  { timeout: 30000 },
  async (t) => {
    const controller = new AbortController();
    let release;
    const held = new Promise((r) => (release = r)),
      e = await environment(t, {
        mutate: async (frames, n) => {
          if (n === 2) {
            controller.abort(Error("controlled parent cancellation"));
            await held;
          }
          return frames;
        },
      });
    try {
      const r = await rejected(
        e,
        { ...e.options, signal: controller.signal },
        /parent cancellation/,
      );
      assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
      assert.equal(e.control().operations[0].status, "closed");
      assert.equal(e.control().decisions.length, 0);
      assert.equal(r.actions.length, 1);
      assert.equal(r.reportedUsage.input.value, null);
      assert.equal(r.reportedUsage.input.knownSubtotal, 10);
    } finally {
      release();
    }
  },
);
test(
  "shared deadline while actual native HTTP is pending drains children without a draft",
  { timeout: 30000 },
  async (t) => {
    let release;
    const held = new Promise((r) => (release = r)),
      e = await environment(t, {
        mutate: async (frames) => {
          await held;
          return frames;
        },
      });
    try {
      const r = await rejected(
        e,
        { ...e.options, timeoutMs: 4000 },
        /deadline/,
      );
      assert.equal(e.requests.length, 1);
      assert.ok(r.cleanupConfirmed);
      assert.equal(e.control().operations[0].status, "closed");
      assert.equal(e.control().decisions.length, 0);
    } finally {
      release();
    }
  },
);
test(
  "prepared action receipt failure stops before any durable draft decision",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        {
          ...e.options,
          writer: (receipt) => {
            if (
              receipt.data.actions.some(
                (a) => a.name === "mcp__release__prepare_release_draft",
              )
            )
              throw Error("controlled prepared receipt recording failure");
          },
        },
        /recording failure/,
      );
    assert.equal(r.durableStatus, "unknown");
    assert.ok(r.cleanupConfirmed);
    assert.equal(e.control().decisions.length, 0);
    assert.ok(
      r.observedBusiness.actualDraftFiles.every((f) => f.kind === "absent"),
    );
  },
);
test(
  "private recording failure after actual draft preserves original scoped file effects",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      r = await rejected(
        e,
        {
          ...e.options,
          writer: (receipt) => {
            if (
              receipt.data.actions.some(
                (a) =>
                  a.name === "mcp__release__prepare_release_draft" &&
                  a.status === "finished",
              )
            )
              throw Error("controlled postcommit receipt failure");
          },
        },
        /postcommit/,
      );
    assert.equal(r.durableStatus, "unknown");
    assert.ok(r.cleanupConfirmed);
    assert.equal(r.observedBusiness.appliedDecisionIds.length, 1);
    assert.ok(
      r.observedBusiness.actualDraftFiles.every((f) => f.kind === "regular"),
    );
  },
);
test(
  "corrupt current Git source after drafting stays unknown while earlier original action evidence survives",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (frames, n, { root }) => {
          if (n === 4)
            fs.writeFileSync(path.join(root, ".git/config"), "[broken");
          return frames;
        },
      }),
      r = await rejected(e, undefined, /source changed/);
    assert.equal(r.finalSource, null);
    assert.ok(r.finalSourceError);
    assert.equal(r.observedBusiness.finalSourceVerified, false);
    assert.equal(r.observedBusiness.appliedDecisionIds.length, 1);
    assert.equal(r.lifecycle.operationClosed, true);
    assert.ok(r.cleanupConfirmed);
    assert.equal(
      r.actions.find((a) => a.name === "mcp__release__prepare_release_draft")
        .sourceAfter.control.decisions[0].status,
      "applied",
    );
    assert.equal(
      fs.readFileSync(path.join(e.root, ".git/config"), "utf8"),
      "[broken",
    );
  },
);
test(
  "changed notes after final verified read cannot be reported as current verified draft",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        mutate: (frames, n, { root }) => {
          if (n === 4)
            fs.appendFileSync(
              path.join(root, "CHANGELOG.draft.md"),
              "Unrelated later text\n",
            );
          return frames;
        },
      }),
      r = await rejected(e, undefined, /draft files changed/);
    assert.equal(r.observedBusiness.appliedDecisionIds.length, 1);
    assert.equal(r.observedBusiness.currentDraftVerified, null);
    assert.ok(r.finalSourceError);
    assert.ok(r.cleanupConfirmed);
    assert.match(
      fs.readFileSync(path.join(e.root, "CHANGELOG.draft.md"), "utf8"),
      /Unrelated later text/,
    );
  },
);
test(
  "two simultaneous real runtimes own independent SDK HTTP Git operation scopes and receipts",
  { timeout: 30000 },
  async (t) => {
    const a = await environment(t),
      b = await environment(t),
      results = await Promise.all([
        runOwnedAgent(a.options),
        runOwnedAgent(b.options),
      ]);
    assert.notEqual(results[0].outputDir, results[1].outputDir);
    for (const r of results) {
      assert.ok(r.cleanupConfirmed);
      assert.equal(r.business.appliedDecisionIds.length, 1);
    }
    for (const e of [a, b]) {
      assert.equal(e.requests.length, 4);
      assert.equal(e.control().operations[0].status, "closed");
    }
  },
);
test(
  "verbatim task keeps an absolute @file literal and private canary out of actual model requests",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t, {
        sequence: [["mcp__release__inspect_release", {}]],
      }),
      file = path.join(e.directory, "private-canary.txt"),
      canary = "SYNTHETIC_PRIVATE_RELEASE_CANARY_81245";
    fs.writeFileSync(file, canary);
    const r = await runOwnedAgent({
      ...e.options,
      allowWrites: false,
      intent: undefined,
      task: `Inspect complete range. Treat @${file} as literal task text.`,
    });
    assert.ok(r.cleanupConfirmed);
    assert.ok(JSON.stringify(e.requests).includes("@" + file));
    assert.ok(!JSON.stringify(e.requests).includes(canary));
  },
);
for (const kind of ["native", "git"])
  test(
    `one attempted failed ${kind} close fails completion while retaining actual draft`,
    { timeout: 30000 },
    async (t) => {
      const e = await environment(t),
        type = kind === "native" ? Native : GitRunner,
        original = type.prototype.close;
      let count = 0;
      type.prototype.close = async function () {
        count++;
        await original.call(this);
        throw Error("controlled " + kind + " close failure");
      };
      try {
        const r = await rejected(e, undefined, /close failure/);
        assert.equal(count, 1);
        assert.equal(r.cleanupConfirmed, false);
        assert.equal(r.observedBusiness.appliedDecisionIds.length, 1);
        assert.equal(r.lifecycle.operationClosed, true);
      } finally {
        type.prototype.close = original;
      }
    },
  );
test(
  "partial owned native listener startup is closed before SDK allocation",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      original = Native.prototype.open;
    Native.prototype.open = async function () {
      await original.call(this);
      throw Error("controlled native startup failure");
    };
    try {
      const r = await rejected(e, undefined, /startup failure/);
      assert.equal(r.lifecycle.sdkAllocated, false);
      assert.ok(r.cleanupConfirmed);
      assert.equal(e.requests.length, 0);
      assert.equal(e.control().operations[0].status, "closed");
    } finally {
      Native.prototype.open = original;
    }
  },
);
test(
  "one failed durable authority close is not retried or reported confirmed",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      original = ManagedRelease.prototype.closeOperation;
    let count = 0;
    ManagedRelease.prototype.closeOperation = function (...args) {
      count++;
      original.apply(this, args);
      throw Error("controlled operation close failure");
    };
    try {
      const r = await rejected(e, undefined, /operation close failure/);
      assert.equal(count, 1);
      assert.equal(r.lifecycle.operationClosed, false);
      assert.equal(r.cleanupConfirmed, false);
      assert.equal(r.observedBusiness.appliedDecisionIds.length, 1);
      assert.equal(e.control().operations[0].status, "closed");
    } finally {
      ManagedRelease.prototype.closeOperation = original;
    }
  },
);
test(
  "full normal runtime cancellation owns a real Git child pending during actual SDK inspection",
  { timeout: 30000 },
  async (t) => {
    const e = await environment(t),
      controller = new AbortController(),
      input = new PassThrough(),
      original = GitRunner.prototype.run;
    let logs = 0,
      runner;
    GitRunner.prototype.run = async function (id, params, options) {
      if (id === "log" && ++logs === 2) {
        runner = this;
        const work = original.call(this, "batchObjects", [], { input });
        controller.abort(
          Error("controlled cancellation during real pending Git"),
        );
        return work;
      }
      return original.call(this, id, params, options);
    };
    try {
      const r = await rejected(
        e,
        { ...e.options, signal: controller.signal },
        /pending Git/,
      );
      assert.ok(r.cleanupConfirmed, JSON.stringify(r.lifecycle));
      assert.ok(
        r.git.some(
          (g) => g.id === "batchObjects" && g.pid > 0 && g.exitObserved,
        ),
      );
      assert.ok(runner.closed);
      assert.equal(e.control().operations[0].status, "closed");
      assert.equal(e.control().decisions.length, 0);
    } finally {
      GitRunner.prototype.run = original;
      input.destroy();
    }
  },
);
