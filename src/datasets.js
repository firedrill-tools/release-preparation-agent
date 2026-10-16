/** Private model-free original cases; no runtime assessment or case branch. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJSON } from "./json.js";
import { hash, readRegular, writeStaged } from "./source.js";
import { same, digest, sourceFrame, draftFiles, DRAFT_NAMES } from "./frame.js";
import { validateFrame, hex, oid, line } from "./snapshot.js";
import { GitRunner } from "./git-runner.js";
import {
  ManagedRelease,
  initializeControl,
  validateControl,
  populationReference,
  populationHeader,
} from "./control.js";
import { DATASET_SHA256, DATASET_BYTES } from "./_dataset-manifest.js";
import { writeImage } from "../scripts/git-image.js";
const imageFile = z.strictObject({
    path: z.string().min(1).max(4096),
    bodyBase64: z.string().max(12 * 1024 * 1024),
    sha256: hex,
    size: z
      .number()
      .int()
      .nonnegative()
      .max(8 * 1024 * 1024),
    mode: z.literal(0o600),
  }),
  imageSchema = z.array(imageFile).max(4096);
const populationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  profile: z.enum(["starter", "busy", "ambiguous", "boundary"]),
  task: z.string().min(1).max(8000),
  image: imageSchema,
  afterImage: imageSchema.nullable(),
  setup: z.strictObject({
    reads: z.number().int().min(0).max(12),
    draft: z.enum(["none", "applied", "prepared", "stale"]),
  }),
  assessment: z.strictObject({
    intentFault: z.enum(["none", "wrong_version"]),
    toolFault: z.enum(["none", "missing_commit"]),
    expected: z.enum([
      "applied",
      "unchanged",
      "reject",
      "prepared_preflight",
      "overflow_preflight",
    ]),
  }),
  graph: z.strictObject({
    baseTag: line(80),
    baseCommit: oid,
    draftHead: oid,
    head: oid,
    commits: z
      .array(
        z.strictObject({
          id: oid,
          parents: z.array(oid).max(8),
          tree: oid,
          message: z.string().max(64000),
          time: z.number().int().positive(),
        }),
      )
      .max(1000),
    tags: z
      .array(z.strictObject({ name: line(80), object: oid, commit: oid }))
      .max(1000),
  }),
  history: z
    .array(
      z.strictObject({
        sequence: z.number().int().positive(),
        kind: z.enum([
          "fictional_imported_release_inspection",
          "fictional_imported_local_draft_record",
        ]),
        head: oid,
        baseTag: line(80),
        version: line(80),
        publicationStatus: z.enum(["unknown", "draft"]),
        priorModelEvidence: z.null(),
        priorHumanAuthentication: z.null(),
      }),
    )
    .max(2000),
  provenance: z.strictObject({
    kind: z.literal("explicit_fictional_original_git_images"),
    priorModelEvidence: z.null(),
    priorHumanAuthentication: z.null(),
    priorPublication: z.null(),
    historyMeaning: z.literal(
      "authored historical source records; not attested prior model executions or fresh runtime authority",
    ),
  }),
});
export function validatePopulation(value) {
  const p = populationSchema.parse(value),
    commits = new Map(p.graph.commits.map((c) => [c.id, c]));
  if (
    commits.size !== p.graph.commits.length ||
    !commits.has(p.graph.baseCommit) ||
    !commits.has(p.graph.head) ||
    !commits.has(p.graph.draftHead) ||
    p.graph.commits.some((c) => c.parents.some((id) => !commits.has(id)))
  )
    throw Error("complete coherent original Git graph required");
  for (const image of [p.image, ...(p.afterImage ? [p.afterImage] : [])]) {
    if (new Set(image.map((f) => f.path)).size !== image.length)
      throw Error("duplicate original image file");
    let total = 0;
    for (const f of image) {
      if (
        !f.path.isWellFormed() ||
        f.path.split("/").some((v) => !v || v === "." || v === "..") ||
        /[\x00-\x1f\\]/.test(f.path) ||
        f.path.startsWith(".git/firedrill-release") ||
        DRAFT_NAMES.includes(f.path)
      )
        throw Error("original image path unsupported");
      const raw = Buffer.from(f.bodyBase64, "base64");
      total += raw.length;
      if (
        raw.toString("base64") !== f.bodyBase64 ||
        hash(raw) !== f.sha256 ||
        raw.length !== f.size ||
        total > 16 * 1024 * 1024
      )
        throw Error("original image bytes/hash differ");
    }
  }
  if (
    p.history.some(
      (h, n) =>
        h.sequence !== n + 1 ||
        !commits.has(h.head) ||
        !p.graph.tags.some(
          (t) =>
            t.name === h.baseTag &&
            t.commit === h.head &&
            t.name === "v" + h.version,
        ),
    )
  )
    throw Error("fictional prior history differs from actual source refs");
  return p;
}
let cached;
function registry() {
  const raw = readRegular(
    fileURLToPath(new URL("../data/index.json", import.meta.url)),
  ).bytes;
  if (raw.length !== DATASET_BYTES || hash(raw) !== DATASET_SHA256)
    throw Error("release populations differ from pinned original bytes");
  if (!cached) {
    const index = z
        .strictObject({
          id: z.literal("release-populations"),
          version: z.literal("1.0.0"),
          cases: z.array(z.unknown()).length(12),
        })
        .parse(
          parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        ),
      rows = index.cases.map(validatePopulation);
    if (
      new Set(rows.map((p) => p.id)).size !== 12 ||
      new Set(rows.map((p) => p.profile)).size !== 4
    )
      throw Error("unique cases and all four profiles required");
    cached = rows;
  }
  return cached;
}
export const populations = () => structuredClone(registry());
function population(id) {
  const p = registry().find((p) => p.id === id);
  if (!p) throw Error("unknown release case");
  return p;
}
export const listCases = () =>
  registry().map((p) => ({
    id: p.id,
    profile: p.profile,
    task: p.task,
    commits: p.graph.commits.length,
    branches: new Set(
      (p.afterImage ?? p.image)
        .filter((f) => f.path.startsWith(".git/refs/heads/"))
        .map((f) => f.path),
    ).size,
    tags: p.graph.tags.length,
    historicalSourceRecords: p.history.length,
    freshSyntheticAuthorReads: p.setup.reads,
    initialDraft: p.setup.draft,
    expectedControl: p.assessment.expected,
  }));
function exclusive(file, raw) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, raw);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
const jsonBytes = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
async function owned(root, action, { signal } = {}) {
  const controller = new AbortController(),
    forward = () =>
      controller.abort(
        signal.reason ?? Error("private case operation cancelled"),
      ),
    owner = {
      signal: controller.signal,
      deadline: performance.now() + 30000,
      receipt: { data: { git: [] }, save() {} },
      basicGuard() {
        this.signal.throwIfAborted();
        if (performance.now() >= this.deadline)
          throw Error("private case operation deadline exceeded");
      },
    };
  let runner;
  signal?.addEventListener("abort", forward, { once: true });
  if (signal?.aborted) forward();
  try {
    owner.basicGuard();
    runner = new GitRunner(root, owner);
    const result = await action(
      new ManagedRelease(runner.root, runner, owner),
      owner,
    );
    owner.basicGuard();
    return result;
  } finally {
    try {
      if (runner) await runner.close();
    } finally {
      signal?.removeEventListener("abort", forward);
    }
  }
}
const seedSchema = z.strictObject({
  frame: z.unknown(),
  draftFiles: z.array(z.unknown()).length(2),
  controlBodyBase64: z.string().max(12 * 1024 * 1024),
  controlSha256: hex,
});
function seedAuthority(store) {
  const current = store.readControl().value;
  if (!current.population)
    throw Error("pinned original release case authority required");
  const p = population(current.population.caseId),
    pointer = populationReference.parse({
      id: "release-populations",
      version: "1.0.0",
      caseId: p.id,
      datasetSha256: DATASET_SHA256,
      definitionSha256: digest(p),
    });
  if (!same(pointer, current.population))
    throw Error("original case definition differs from current authority");
  const header = populationHeader.parse(
      parseJSON(
        readRegular(path.join(store.directory, "population.json")).text,
      ),
    ),
    seedRaw = readRegular(path.join(store.directory, "population-seed.json")),
    seed = seedSchema.parse(parseJSON(seedRaw.text)),
    raw = Buffer.from(seed.controlBodyBase64, "base64");
  if (
    raw.toString("base64") !== seed.controlBodyBase64 ||
    hash(raw) !== seed.controlSha256 ||
    seedRaw.sha256 !== header.seedSha256
  )
    throw Error("original private seed bytes differ");
  const initial = validateControl(
    parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
  );
  validateFrame(seed.frame);
  if (
    initial.instanceId !== current.instanceId ||
    initial.rootIdentity !== current.rootIdentity ||
    seed.frame.rootIdentity !== current.rootIdentity ||
    !same(initial.population, current.population) ||
    initial.operations.length ||
    initial.reads.length !== p.setup.reads ||
    initial.reads.some(
      (r) =>
        r.scope.kind !== "synthetic_human" ||
        r.instanceId !== current.instanceId,
    )
  )
    throw Error("original private seed cannot claim runtime model authority");
  if (
    p.setup.draft === "none"
      ? initial.decisions.length !== 0
      : initial.decisions.length !== 1 ||
        initial.decisions[0].scope.kind !== "synthetic_human" ||
        initial.decisions[0].status !==
          (p.setup.draft === "prepared" ? "prepared" : "applied")
  )
    throw Error("original seed draft record differs from case setup");
  for (const f of seed.draftFiles) {
    if (
      !DRAFT_NAMES.includes(f.path) ||
      !["absent", "regular"].includes(f.kind)
    )
      throw Error("original seed draft path/kind differs");
    if (f.kind === "regular") {
      const raw = Buffer.from(f.bodyBase64, "base64");
      if (
        raw.toString("base64") !== f.bodyBase64 ||
        hash(raw) !== f.sha256 ||
        raw.length !== f.size
      )
        throw Error("original seed draft bytes differ");
    }
  }
  if (
    !same(
      seed.draftFiles.map((f) => f.path),
      DRAFT_NAMES,
    )
  )
    throw Error("original seed fixed draft paths differ");
  return { p, header, seed, current };
}
export async function inspect(root, options = {}) {
  return owned(
    root,
    async (store) => {
      const authority = seedAuthority(store),
        frame = sourceFrame(store.root),
        files = draftFiles(store.root),
        control = store.readControl();
      let source = null,
        error = null;
      try {
        source = await store.capture();
      } catch (e) {
        error = e.message;
      }
      const originalSeedMatch =
        same(frame, authority.seed.frame) &&
        same(files, authority.seed.draftFiles) &&
        control.source.sha256 === authority.seed.controlSha256;
      return {
        ok: true,
        root: store.root,
        instanceId: store.instanceId,
        caseId: authority.p.id,
        datasetSha256: DATASET_SHA256,
        definitionSha256: digest(authority.p),
        originalSeedMatch,
        applicationValid: source !== null,
        applicationError: error,
        runtimeReady:
          source !== null &&
          !control.value.decisions.some((d) => d.status === "prepared"),
        source,
        privateCurrent: {
          frame,
          draftFiles: files,
          controlBodyBase64: control.source.bytes.toString("base64"),
          control: control.value,
        },
        seedScope: authority.header.scope,
        provenance: authority.p.provenance,
      };
    },
    options,
  );
}
function applyLaterImage(root, before, after) {
  const old = new Map(before.map((f) => [f.path, f])),
    next = new Map(after.map((f) => [f.path, f]));
  if (before.some((f) => !next.has(f.path)))
    throw Error("later source cannot silently delete original files");
  for (const f of after) {
    const prior = old.get(f.path),
      target = path.join(root, f.path),
      raw = Buffer.from(f.bodyBase64, "base64");
    if (prior?.sha256 === f.sha256) continue;
    if (prior) {
      const observed = readRegular(target, { binary: true });
      if (observed.sha256 !== prior.sha256)
        throw Error(
          "initial case source changed before explicit later authoring",
        );
      writeStaged(target, raw, () => {
        const current = readRegular(target, { binary: true });
        if (
          current.sha256 !== observed.sha256 ||
          current.identity !== observed.identity
        )
          throw Error("case source changed before later image commit");
      });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      exclusive(target, raw);
    }
  }
}
export async function initialize(
  root,
  caseId = "complete-release",
  options = {},
) {
  options.signal?.throwIfAborted();
  root = path.resolve(root);
  const p = population(caseId);
  root = writeImage(root, p.image);
  initializeControl(root);
  await owned(
    root,
    async (store, owner) => {
      let view;
      for (let n = 0; n < p.setup.reads; n++) view = await store.inspect();
      if (p.setup.draft !== "none") {
        const args = {
            version: view.nextVersion,
            baseTag: view.baseTag,
            expectedHead: view.head,
            commitIds: view.commits.map((c) => c.id),
          },
          guard = owner.basicGuard.bind(owner);
        if (p.setup.draft === "prepared")
          owner.basicGuard = () => {
            guard();
            if (
              fs.existsSync(path.join(root, DRAFT_NAMES[0])) &&
              !fs.existsSync(path.join(root, DRAFT_NAMES[1]))
            )
              throw Error(
                "explicit synthetic author interruption between draft files",
              );
          };
        try {
          const result = await store.prepare(args);
          if (result.error) throw Error(result.error);
          if (p.setup.draft === "prepared")
            throw Error("declared partial source was not interrupted");
        } catch (e) {
          if (
            p.setup.draft !== "prepared" ||
            !e.partialDraft ||
            !e.message.includes("explicit synthetic author interruption")
          )
            throw e;
        } finally {
          owner.basicGuard = guard;
        }
      }
      if (p.afterImage) applyLaterImage(root, p.image, p.afterImage);
      const original = store.readControl(),
        control = structuredClone(original.value);
      control.population = {
        id: "release-populations",
        version: "1.0.0",
        caseId: p.id,
        datasetSha256: DATASET_SHA256,
        definitionSha256: digest(p),
      };
      validateControl(control);
      const frame = sourceFrame(root),
        files = draftFiles(root),
        controlBytes = jsonBytes(control),
        seed = jsonBytes({
          frame,
          draftFiles: files,
          controlBodyBase64: controlBytes.toString("base64"),
          controlSha256: hash(controlBytes),
        });
      if (seed.length > 8 * 1024 * 1024)
        throw Error("complete original private seed exceeds authority bound");
      const header = populationHeader.parse({
        ...control.population,
        schemaVersion: 1,
        instanceId: store.instanceId,
        seedSha256: hash(seed),
        createdAt: new Date().toISOString(),
        scope: "original_explicit_synthetic_git_seed",
      });
      exclusive(path.join(store.directory, "population-seed.json"), seed);
      exclusive(
        path.join(store.directory, "population.json"),
        jsonBytes(header),
      );
      // Separate initialization file effects. Incomplete initialization stays private
      // and cannot open as a valid normal managed case until this final pointer.
      writeStaged(store.file, controlBytes, () => {
        const current = readRegular(store.file);
        if (
          current.sha256 !== original.source.sha256 ||
          current.identity !== original.source.identity ||
          !same(sourceFrame(root), frame) ||
          !same(draftFiles(root), files)
        )
          throw Error("case source changed before authority publication");
      });
    },
    options,
  );
  return inspect(root, options);
}
export async function reset(root, destination, options = {}) {
  if (path.resolve(root) === path.resolve(destination))
    throw Error("reset needs a distinct fresh destination");
  const current = await inspect(root, options);
  if (!current.applicationValid && !current.originalSeedMatch)
    throw Error("unrecognized corrupt source cannot reset");
  return initialize(destination, current.caseId, options);
}
