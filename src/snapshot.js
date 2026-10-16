import path from "node:path";
import { z } from "zod";
import { parseJSON } from "./json.js";
import { hash } from "./source.js";
import { deriveVersion, stableVersion } from "./version.js";
import {
  sourceFrame,
  draftFiles,
  validateRoot,
  same,
  digest,
  canonical,
} from "./frame.js";
export const oid = z.string().regex(/^[a-f0-9]{40}$/),
  hex = z.string().regex(/^[a-f0-9]{64}$/),
  version = z.string().refine((v) => {
    try {
      stableVersion(v);
      return true;
    } catch {
      return false;
    }
  }),
  line = (n) =>
    z
      .string()
      .min(1)
      .max(n)
      .refine((v) => v.isWellFormed() && !/[\x00-\x1f\x7f]/.test(v));
export const draftArgs = z.strictObject({
  version,
  baseTag: line(80),
  expectedHead: oid,
  commitIds: z.array(oid).min(1).max(1000),
});
export const intentSchema = z.strictObject({
  repository: line(160),
  version,
  baseTag: line(80),
  baseCommit: oid,
  head: oid,
  commitIds: z.array(oid).min(1).max(1000),
});
const fileSchema = z.strictObject({
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (v) =>
          !path.posix.isAbsolute(v) &&
          v.split("/").every((p) => p && p !== "." && p !== "..") &&
          !v.includes("\0") &&
          !v.startsWith(".git/firedrill-release/"),
      ),
    bodyBase64: z.string().max(12 * 1024 * 1024),
    sha256: hex,
    size: z
      .number()
      .int()
      .nonnegative()
      .max(8 * 1024 * 1024),
    mode: z.number().int().min(0).max(511),
    identity: line(160),
  }),
  frameSchema = z.strictObject({
    rootIdentity: line(160),
    files: z.array(fileSchema).max(4096),
    sha256: hex,
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(16 * 1024 * 1024),
  }),
  wireSchema = z.strictObject({
    stdoutBase64: z.string().max(2 * 1024 * 1024),
    stderrBase64: z.string().max(2 * 1024 * 1024),
    stdoutSha256: hex,
    stderrSha256: hex,
    exitCode: z.literal(0),
  });
const keys = [
  "root",
  "format",
  "remotes",
  "fsck",
  "head",
  "tree",
  "branch",
  "refs",
  "tagObject",
  "base",
  "ancestor",
  "log",
  "ids",
  "status",
  "index",
  "tags",
];
const draftFileSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    path: z.enum(["CHANGELOG.draft.md", "release-draft.json"]),
    kind: z.literal("absent"),
  }),
  z.strictObject({
    path: z.enum(["CHANGELOG.draft.md", "release-draft.json"]),
    kind: z.literal("unsupported"),
  }),
  fileSchema.omit({ path: true }).extend({
    path: z.enum(["CHANGELOG.draft.md", "release-draft.json"]),
    kind: z.literal("regular"),
  }),
]);
const snapshotSchema = z.strictObject({
  drafts: z.array(draftFileSchema).length(2),
  frame: frameSchema,
  outputs: z.record(z.enum(keys), wireSchema),
  business: z.unknown(),
  sourceSha256: hex,
  contextSha256: hex,
});
export const decode = (b64) => {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.toString("base64") !== b64)
    throw Error("noncanonical original base64");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};
export function validateFrame(value) {
  const f = frameSchema.parse(value);
  if (
    new Set(f.files.map((r) => r.path)).size !== f.files.length ||
    f.sha256 !== digest(f.files)
  )
    throw Error("original source image differs");
  let bytes = 0;
  for (const file of f.files) {
    const raw = Buffer.from(file.bodyBase64, "base64");
    if (
      raw.toString("base64") !== file.bodyBase64 ||
      raw.length !== file.size ||
      hash(raw) !== file.sha256
    )
      throw Error("original source file bytes/hash differ");
    bytes += raw.length;
  }
  if (bytes !== f.bytes) throw Error("source image byte total differs");
  return f;
}
function manifestFor(frame) {
  const file = frame.files.find((f) => f.path === "package.json"),
    marker = frame.files.find((f) => f.path === ".firedrill-release-sample");
  if (
    !file ||
    !marker ||
    decode(marker.bodyBase64) !== "synthetic release sample\n"
  )
    throw Error("exact original source marker/manifest required");
  return {
    file,
    value: z
      .object({ name: line(160), version, private: z.literal(true) })
      .passthrough()
      .parse(parseJSON(decode(file.bodyBase64))),
  };
}
function statusOf(text) {
  if (!text) return [];
  if (!text.endsWith("\0")) throw Error("incomplete Git status framing");
  const fields = text.slice(0, -1).split("\0"),
    records = [];
  for (let n = 0; n < fields.length; n++) {
    const f = fields[n];
    if (!/^[ MARCUD?!]{2} /.test(f) || f.length < 4)
      throw Error("invalid original Git status record");
    const item = { code: f.slice(0, 2), path: f.slice(3) };
    if (/[RC]/.test(item.code)) {
      if (!fields[n + 1]) throw Error("rename status lacks original path");
      item.originalPath = fields[++n];
    }
    records.push(item);
  }
  return records;
}
export function businessFor(frame, outputs) {
  const { file, value: manifest } = manifestFor(frame),
    text = (id) => {
      const o = outputs[id];
      if (!o || o.exitCode !== 0)
        throw Error("complete Git outputs required: " + id);
      const stdout = Buffer.from(o.stdoutBase64, "base64"),
        stderr = Buffer.from(o.stderrBase64, "base64");
      if (
        stdout.toString("base64") !== o.stdoutBase64 ||
        stderr.toString("base64") !== o.stderrBase64 ||
        hash(stdout) !== o.stdoutSha256 ||
        hash(stderr) !== o.stderrSha256
      )
        throw Error("original Git output differs");
      return decode(o.stdoutBase64);
    };
  for (const key of keys) text(key);
  if (text("format").trim() !== "sha1" || text("remotes").trim())
    throw Error("only complete local SHA1 fixture supported");
  const head = oid.parse(text("head").trim()),
    baseCommit = oid.parse(text("base").trim()),
    baseTagObject = oid.parse(text("tagObject").trim()),
    tree = oid.parse(text("tree").trim()),
    branch = text("branch").trim();
  if (!/^refs\/heads\/[^\x00-\x20~^:?*\[\\]+$/.test(branch))
    throw Error("current branch unsupported");
  const raw = text("log");
  if (raw && !raw.endsWith("\0")) throw Error("incomplete full commit framing");
  const fields = raw ? raw.slice(0, -1).split("\0") : [];
  if (fields.length % 3) throw Error("ambiguous full commit framing");
  const commits = [];
  for (let n = 0; n < fields.length; n += 3) {
    const message = fields[n + 2];
    commits.push({
      id: oid.parse(fields[n]),
      parents: fields[n + 1]
        ? fields[n + 1].split(" ").map((v) => oid.parse(v))
        : [],
      subject: message.split("\n", 1)[0].replace(/\r$/, ""),
      message,
    });
  }
  const ids = text("ids").trim().split("\n").filter(Boolean);
  if (
    new Set(ids).size !== commits.length ||
    !same(
      ids,
      commits.map((c) => c.id),
    )
  )
    throw Error("full original graph/range differs");
  const refs = text("refs")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const at = row.indexOf(" ");
      return {
        id: oid.parse(row.slice(0, at)),
        name: line(400).parse(row.slice(at + 1)),
      };
    });
  if (
    !refs.some((r) => r.name === branch && r.id === head) ||
    !refs.some(
      (r) =>
        r.name === "refs/tags/v" + manifest.version && r.id === baseTagObject,
    )
  )
    throw Error("current branch/base ref differ");
  const status = statusOf(text("status")),
    policy = deriveVersion(manifest.version, commits);
  return {
    repository: manifest.name,
    currentVersion: manifest.version,
    manifestSha256: file.sha256,
    baseTag: "v" + manifest.version,
    baseTagObject,
    baseCommit,
    head,
    tree,
    branch,
    refs,
    commits,
    ...policy,
    status,
    clean: status.length === 0,
    remotes: [],
    tags: text("tags").trim().split("\n").filter(Boolean),
    indexSha256: outputs.index.stdoutSha256,
  };
}
export function stableSource(frame, outputs) {
  return digest({
    frame,
    outputs: Object.fromEntries(
      Object.entries(outputs).filter(([k]) => k !== "status"),
    ),
  });
}
export function contextFor(b) {
  const value = { ...b };
  delete value.status;
  delete value.clean;
  return digest(value);
}
export function validateSnapshot(value) {
  const s = snapshotSchema.parse(value);
  validateFrame(s.frame);
  if (
    !same(
      s.drafts.map((d) => d.path),
      ["CHANGELOG.draft.md", "release-draft.json"],
    )
  )
    throw Error("fixed draft evidence paths differ");
  for (const file of s.drafts.filter((d) => d.kind === "regular")) {
    const raw = Buffer.from(file.bodyBase64, "base64");
    if (
      raw.toString("base64") !== file.bodyBase64 ||
      hash(raw) !== file.sha256 ||
      raw.length !== file.size
    )
      throw Error("observed draft bytes differ");
  }
  if (!same(Object.keys(s.outputs).sort(), [...keys].sort()))
    throw Error("missing or extra original Git output");
  const business = businessFor(s.frame, s.outputs);
  if (
    !same(business, s.business) ||
    s.sourceSha256 !== stableSource(s.frame, s.outputs) ||
    s.contextSha256 !== contextFor(business)
  )
    throw Error("stored Git source/context differs");
  return s;
}
export async function inspectSnapshot(root, runner, { cleanup = false } = {}) {
  root = validateRoot(root);
  const frame = sourceFrame(root),
    { value: manifest } = manifestFor(frame),
    outputs = {};
  async function run(key, params = []) {
    const result = await runner.run(key, params, { cleanup });
    outputs[key] = {
      stdoutBase64: result.stdout.toString("base64"),
      stderrBase64: result.stderr.toString("base64"),
      stdoutSha256: hash(result.stdout),
      stderrSha256: hash(result.stderr),
      exitCode: result.exitCode,
    };
    return new TextDecoder("utf-8", { fatal: true })
      .decode(result.stdout)
      .trim();
  }
  const actualRoot = await run("root");
  if (path.resolve(actualRoot) !== root) throw Error("actual Git root differs");
  await run("format");
  if (await run("remotes")) throw Error("remote repositories unsupported");
  await run("fsck");
  const head = oid.parse(await run("head"));
  await run("tree");
  await run("branch");
  await run("refs");
  await run("tagObject", ["v" + manifest.version]);
  const base = oid.parse(await run("base", ["v" + manifest.version]));
  await run("ancestor", [base, head]);
  await run("log", [base + ".." + head]);
  await run("ids", [base + ".." + head]);
  await run("status");
  await run("index");
  await run("tags");
  if (!same(frame, sourceFrame(root)))
    throw Error("complete repository changed during inspection");
  const business = businessFor(frame, outputs);
  return validateSnapshot({
    drafts: draftFiles(root),
    frame,
    outputs,
    business,
    sourceSha256: stableSource(frame, outputs),
    contextSha256: contextFor(business),
  });
}
export function intentFor(b) {
  return {
    repository: b.repository,
    version: b.nextVersion,
    baseTag: b.baseTag,
    baseCommit: b.baseCommit,
    head: b.head,
    commitIds: b.commits.map((c) => c.id),
  };
}
