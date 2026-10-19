/** Parent-owned real read-only Git children; no shell, publication or hook tool. */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { hash } from "./source.js";
const oid = z.string().regex(/^[a-f0-9]{40}$/),
  range = z.string().regex(/^[a-f0-9]{40}\.\.[a-f0-9]{40}$/),
  tag = z
    .string()
    .regex(
      /^v(?:0|[1-9][0-9]{0,15})\.(?:0|[1-9][0-9]{0,15})\.(?:0|[1-9][0-9]{0,15})$/,
    );
const fixed = {
  root: ["rev-parse", "--show-toplevel"],
  format: ["rev-parse", "--show-object-format"],
  remotes: ["remote"],
  fsck: ["fsck", "--strict", "--no-dangling"],
  head: ["rev-parse", "HEAD"],
  tree: ["rev-parse", "HEAD^{tree}"],
  branch: ["symbolic-ref", "--quiet", "HEAD"],
  refs: ["show-ref", "--heads", "--tags", "-d"],
  status: [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
  ],
  index: ["ls-files", "--stage", "-z"],
  tags: ["tag", "--list"],
  batchObjects: ["cat-file", "--batch"],
};
export function gitArguments(id, params = []) {
  if (!Array.isArray(params)) throw Error("Git parameter array required");
  if (fixed[id]) {
    if (params.length) throw Error("fixed Git operation received arguments");
    return [...fixed[id]];
  }
  if (id === "tagObject" || id === "base") {
    if (params.length !== 1) throw Error("one exact base tag required");
    const value = tag.parse(params[0]);
    return [
      "rev-parse",
      "--verify",
      "refs/tags/" + value + (id === "base" ? "^{commit}" : ""),
    ];
  }
  if (id === "ancestor") {
    if (params.length !== 2) throw Error("two exact commit IDs required");
    return ["merge-base", "--is-ancestor", ...params.map((v) => oid.parse(v))];
  }
  if (id === "log" || id === "ids") {
    if (params.length !== 1) throw Error("one exact range required");
    const value = range.parse(params[0]);
    return id === "log"
      ? ["log", "--topo-order", "--format=%H%x00%P%x00%B", "-z", value]
      : ["rev-list", "--topo-order", value];
  }
  throw Error("unsupported Git operation");
}
export const gitEnvironment = () => ({
  ...Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "USER",
      "LOGNAME",
      "LANG",
      "SystemRoot",
      "WINDIR",
    ]
      .filter((k) => typeof process.env[k] === "string")
      .map((k) => [k, process.env[k]]),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_LITERAL_PATHSPECS: "1",
});
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Git child exit unconfirmed")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export class GitRunner {
  constructor(root, owner) {
    this.root = fs.realpathSync(root);
    this.owner = owner;
    this.children = [];
    this.pending = new Set();
    this.closeAttempted = false;
    this.closed = false;
    this.active = false;
  }
  async run(id, params = [], { cleanup = false, input = "" } = {}) {
    if (this.closeAttempted || this.active)
      throw Error("Git runner closing or has a parallel command");
    if (!cleanup) this.owner.basicGuard();
    const args = gitArguments(id, params),
      receipt = this.owner.receipt;
    receipt.data.git ??= [];
    if (!cleanup && receipt.data.git.length >= 512)
      throw Error("Git command budget exhausted");
    const record = {
      number: receipt.data.git.length + 1,
      id,
      args,
      status: "prepared",
      pid: null,
      exitCode: null,
      exitSignal: null,
      stdout: null,
      stderr: null,
    };
    receipt.data.git.push(record);
    const save = () => {
      if (cleanup) {
        try {
          receipt.save();
        } catch {}
      } else receipt.save();
    };
    save();
    this.active = true;
    let child, entry, timer, force, error;
    const streams = { stdout: [], stderr: [] },
      seen = { stdout: 0, stderr: 0 };
    let retained = 0,
      truncated = false;
    const stop = (reason) => {
      error ??= reason;
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        force ??= setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }, 1000);
      }
    };
    if (cleanup) {
      // The full final observation persists all 16 Git command receipts. Large
      // managed populations retain tens of MiB of original source evidence;
      // allow their durable writes while preserving each child's 5s limit.
      this.cleanupDeadline ??= performance.now() + 30000;
      if (performance.now() >= this.cleanupDeadline) {
        this.active = false;
        throw Error("Git final observation cleanup budget exhausted");
      }
    }
    const phase = new AbortController(),
      ms = cleanup
        ? Math.max(
            1,
            Math.min(5000, Math.ceil(this.cleanupDeadline - performance.now())),
          )
        : Math.max(
            1,
            Math.min(5000, Math.ceil(this.owner.deadline - performance.now())),
          ),
      signal = cleanup
        ? phase.signal
        : AbortSignal.any([this.owner.signal, phase.signal]);
    const abort = () => stop(signal.reason ?? Error("Git command cancelled"));
    try {
      if (!cleanup) this.owner.basicGuard();
      child = spawn(
        "git",
        [
          "--no-pager",
          `--git-dir=${path.join(this.root, ".git")}`,
          `--work-tree=${this.root}`,
          "-c",
          `core.worktree=${this.root}`,
          "-c",
          "core.fsmonitor=false",
          "-c",
          `core.hooksPath=${os.devNull}`,
          "-c",
          "core.pager=cat",
          ...args,
        ],
        {
          cwd: this.root,
          env: gitEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const closed = new Promise((resolve) =>
        child.once("close", (code, sig) => {
          record.exitCode = code;
          record.exitSignal = sig;
          record.exitObserved = true;
          resolve();
        }),
      );
      entry = { child, closed, record };
      this.children.push(entry);
      this.pending.add(closed);
      record.pid = child.pid ?? null;
      child.once("error", (e) => {
        error ??= e;
      });
      child.stdin.on("error", (e) => {
        if (e.code !== "EPIPE") stop(e);
      });
      for (const kind of ["stdout", "stderr"])
        child[kind].on("data", (chunk) => {
          seen[kind] += chunk.length;
          const left = 1024 * 1024 - retained,
            part = chunk.subarray(0, Math.max(0, left));
          streams[kind].push(part);
          retained += part.length;
          if (part.length !== chunk.length) {
            truncated = true;
            stop(Error("Git output exceeds retained limit"));
          }
        });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(
        () =>
          phase.abort(
            Error(
              cleanup
                ? "Git cleanup deadline exceeded"
                : ms < 5000
                  ? "release operation deadline exceeded during Git"
                  : "Git command deadline exceeded",
            ),
          ),
        ms,
      );
      if (typeof input === "string" || Buffer.isBuffer(input))
        child.stdin.end(input);
      else if (input && typeof input.pipe === "function") {
        input.on("error", stop);
        input.pipe(child.stdin);
      } else
        throw Error("Git input must be finite text/buffer or an owned stream");
      save();
      await within(closed, ms + 2500);
      if (!error && record.exitCode !== 0)
        error = Error(
          `Git ${id} exited ${record.exitCode ?? record.exitSignal}`,
        );
      const complete =
        !truncated &&
        !error?.message?.includes("deadline") &&
        !signal.aborted &&
        record.exitObserved;
      for (const kind of ["stdout", "stderr"]) {
        const raw = Buffer.concat(streams[kind]);
        record[kind] = {
          bodyBase64: raw.toString("base64"),
          decodedBytes: raw.length,
          observedBytes: seen[kind],
          complete,
          sha256: complete ? hash(raw) : null,
          prefixSha256: hash(raw),
        };
      }
      if (error) throw error;
      record.status = "finished";
      save();
      return {
        stdout: Buffer.from(record.stdout.bodyBase64, "base64"),
        stderr: Buffer.from(record.stderr.bodyBase64, "base64"),
        exitCode: record.exitCode,
      };
    } catch (e) {
      error ??= e;
      stop(error);
      if (entry && !record.exitObserved)
        try {
          await within(entry.closed, 2500);
        } catch (exit) {
          record.exitError = exit.message;
        }
      for (const kind of ["stdout", "stderr"])
        if (!record[kind]) {
          const raw = Buffer.concat(streams[kind]);
          record[kind] = {
            bodyBase64: raw.toString("base64"),
            decodedBytes: raw.length,
            observedBytes: seen[kind],
            complete: false,
            sha256: null,
            prefixSha256: hash(raw),
          };
        }
      record.status = "failed";
      record.error = error.message;
      try {
        save();
      } catch {}
      throw Object.assign(error, { gitRecord: record });
    } finally {
      clearTimeout(timer);
      clearTimeout(force);
      signal.removeEventListener("abort", abort);
      if (entry) this.pending.delete(entry.closed);
      this.active = false;
    }
  }
  async close() {
    if (this.closeAttempted) throw Error("Git close already attempted");
    this.closeAttempted = true;
    let failure;
    for (const e of this.children) {
      if (!e.record.exitObserved) {
        if (e.child.exitCode === null && e.child.signalCode === null)
          e.child.kill("SIGTERM");
        const force = setTimeout(() => {
          if (e.child.exitCode === null && e.child.signalCode === null)
            e.child.kill("SIGKILL");
        }, 1000);
        try {
          await within(e.closed, 2500);
        } catch (error) {
          failure ??= error;
        } finally {
          clearTimeout(force);
        }
      }
    }
    await Promise.allSettled([...this.pending]);
    if (failure || this.children.some((e) => !e.record.exitObserved))
      throw failure ?? Error("Git processes not drained");
    this.closed = true;
  }
}
