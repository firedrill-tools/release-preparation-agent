/** Durable fictional release authority and truthful separate file commits. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { readRegular, writeStaged, hash } from "./source.js";
import { parseJSON } from "./json.js";
import { DATASET_SHA256 } from "./_dataset-manifest.js";
import {
  validateRoot,
  sourceFrame,
  draftFiles,
  CONTROL,
  DRAFT_NAMES,
  digest,
  same,
} from "./frame.js";
import {
  inspectSnapshot,
  validateSnapshot,
  intentSchema,
  intentFor,
  draftArgs,
  hex,
  line,
  oid,
  version,
} from "./snapshot.js";
const uuid = z.string().uuid(),
  scopeSchema = z.strictObject({
    kind: z.enum(["operator", "synthetic_human"]),
    operationId: uuid.nullable(),
  }),
  operationSchema = z.strictObject({
    id: uuid,
    credentialSha256: hex,
    taskSha256: hex,
    allowWrites: z.boolean(),
    intent: intentSchema.nullable(),
    status: z.enum(["active", "closed"]),
  });
const readSchema = z.strictObject({
  id: uuid,
  instanceId: uuid.nullable(),
  scope: scopeSchema,
  source: z.unknown(),
  contentSha256: hex,
});
const decisionSchema = z.strictObject({
  id: uuid,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  instanceId: uuid.nullable(),
  scope: scopeSchema,
  readId: uuid,
  sourceSha256: hex,
  args: draftArgs,
  source: z.unknown(),
  notesBase64: z.string().max(2 * 1024 * 1024),
  metadataBase64: z.string().max(2 * 1024 * 1024),
  notesSha256: hex,
  metadataSha256: hex,
  status: z.enum(["prepared", "applied", "unchanged"]),
  referencedDecisionId: uuid.nullable(),
});
export const populationReference = z.strictObject({
  id: z.literal("release-populations"),
  version: z.literal("1.0.0"),
  caseId: line(80),
  datasetSha256: z.literal(DATASET_SHA256),
  definitionSha256: hex,
});
export const populationHeader = populationReference
  .extend({
    schemaVersion: z.literal(1),
    instanceId: uuid,
    seedSha256: hex,
    createdAt: z.string().datetime(),
    scope: z.literal("original_explicit_synthetic_git_seed"),
  })
  .strict();
const controlSchema = z.strictObject({
  synthetic: z.literal(true),
  version: z.literal(1),
  instanceId: uuid,
  rootIdentity: line(160),
  population: populationReference.nullable(),
  provenance: z.strictObject({
    kind: z.literal("explicit_synthetic_release_author"),
    priorModelEvidence: z.null(),
    priorHumanAuthentication: z.null(),
    priorPublication: z.null(),
  }),
  operations: z.array(operationSchema).max(512),
  reads: z.array(readSchema).max(1024),
  decisions: z.array(decisionSchema).max(512),
});
export const metadataSchema = z.strictObject({
  version,
  baseTag: line(80),
  baseCommit: oid,
  head: oid,
  commitIds: z.array(oid).min(1).max(1000),
  publicationStatus: z.literal("draft"),
  notesFile: z.literal("CHANGELOG.draft.md"),
  manifestSha256: hex,
  notesSha256: hex,
  workspaceInstanceId: uuid,
  decisionId: uuid,
  sourceSha256: hex,
  contextSha256: hex,
});
export const readHash = (r) =>
  digest({
    id: r.id,
    instanceId: r.instanceId,
    scope: r.scope,
    source: r.source,
  });
export function draftContent(source, id, instanceId) {
  const s = source.business,
    notes = `# ${s.repository} v${s.nextVersion}\n\nDraft release notes. Publication is separate.\n\n## Changes since ${s.baseTag}\n\n${s.commits.map((c) => `- ${c.subject} (${c.id.slice(0, 7)})`).join("\n")}\n`,
    metadata = metadataSchema.parse({
      version: s.nextVersion,
      baseTag: s.baseTag,
      baseCommit: s.baseCommit,
      head: s.head,
      commitIds: s.commits.map((c) => c.id),
      publicationStatus: "draft",
      notesFile: DRAFT_NAMES[0],
      manifestSha256: s.manifestSha256,
      notesSha256: hash(Buffer.from(notes)),
      workspaceInstanceId: instanceId,
      decisionId: id,
      sourceSha256: source.sourceSha256,
      contextSha256: source.contextSha256,
    });
  return {
    notes: Buffer.from(notes),
    metadata: Buffer.from(JSON.stringify(metadata, null, 2) + "\n"),
  };
}
const body = (value, expected) => {
  const raw = Buffer.from(value, "base64");
  if (raw.toString("base64") !== value || hash(raw) !== expected)
    throw Error("original draft bytes/hash differ");
  return raw;
};
export function validateControl(value) {
  const c = controlSchema.parse(value),
    ops = new Map(c.operations.map((o) => [o.id, o])),
    reads = new Map(c.reads.map((r) => [r.id, r])),
    decisions = new Map(c.decisions.map((d) => [d.id, d]));
  for (const [key, rows] of [
    ["operation", c.operations],
    ["read", c.reads],
    ["decision", c.decisions],
  ])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw Error("duplicate release " + key);
  if (
    new Set(c.operations.map((o) => o.credentialSha256)).size !==
    c.operations.length
  )
    throw Error("duplicate release credential");
  for (const o of c.operations)
    if (o.allowWrites ? !o.intent : o.intent !== null)
      throw Error("operation permission/intent differs");
  const scope = (s) => {
    if (
      s.kind === "operator" ? !ops.has(s.operationId) : s.operationId !== null
    )
      throw Error("invalid release scope");
  };
  for (const r of c.reads) {
    scope(r.scope);
    const s = validateSnapshot(r.source);
    if (
      (r.instanceId !== null && r.instanceId !== c.instanceId) ||
      (r.scope.kind === "operator" && r.instanceId !== c.instanceId) ||
      (r.instanceId !== null && s.frame.rootIdentity !== c.rootIdentity) ||
      r.contentSha256 !== readHash(r)
    )
      throw Error("durable release read differs from original instance/source");
  }
  const used = new Set();
  for (const [n, d] of c.decisions.entries()) {
    scope(d.scope);
    const s = validateSnapshot(d.source),
      r = reads.get(d.readId);
    if (
      d.sequence !== n + 1 ||
      d.instanceId !== c.instanceId ||
      !r ||
      r.instanceId !== d.instanceId ||
      !same(r.scope, d.scope) ||
      !same(r.source, s) ||
      d.sourceSha256 !== s.sourceSha256 ||
      used.has(r.id)
    )
      throw Error("release decision lacks unique exact original read");
    used.add(r.id);
    if (
      !same(d.args, {
        version: s.business.nextVersion,
        baseTag: s.business.baseTag,
        expectedHead: s.business.head,
        commitIds: s.business.commits.map((c) => c.id),
      })
    )
      throw Error("release decision args differ from original source");
    const op = ops.get(d.scope.operationId);
    if (
      d.scope.kind === "operator" &&
      (!op.allowWrites || !same(op.intent, intentFor(s.business)))
    )
      throw Error("release decision lacked caller intent");
    const note = body(d.notesBase64, d.notesSha256),
      meta = body(d.metadataBase64, d.metadataSha256);
    metadataSchema.parse(
      parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(meta)),
    );
    if (d.status === "unchanged") {
      if (
        s.drafts.some((f) => f.kind !== "regular") ||
        s.drafts[0].sha256 !== d.notesSha256 ||
        s.drafts[1].sha256 !== d.metadataSha256 ||
        s.business.status.some(
          (row) =>
            !DRAFT_NAMES.includes(row.path) || !["??", "!!"].includes(row.code),
        )
      )
        throw Error("unchanged draft lacks genuine existing file evidence");
      const original = decisions.get(d.referencedDecisionId);
      if (
        !original ||
        original.sequence >= d.sequence ||
        original.status !== "applied" ||
        original.sourceSha256 !== d.sourceSha256 ||
        original.notesSha256 !== d.notesSha256 ||
        original.metadataSha256 !== d.metadataSha256
      )
        throw Error("unchanged release differs from genuine previous draft");
    } else {
      if (s.business.status.length || s.drafts.some((f) => f.kind !== "absent"))
        throw Error(
          "changed draft did not have clean source and absent destinations",
        );
      if (d.referencedDecisionId !== null)
        throw Error("changed release cannot borrow another decision");
      const expected = draftContent(s, d.id, c.instanceId);
      if (!note.equals(expected.notes) || !meta.equals(expected.metadata))
        throw Error("prepared release bytes differ from exact original source");
    }
    if (d.status === "prepared" && n !== c.decisions.length - 1)
      throw Error("unresolved draft cannot have subsequent decisions");
  }
  return c;
}
function exclusive(file, raw, guard = () => {}) {
  guard();
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
export function initializeControl(root) {
  root = validateRoot(root);
  const directory = path.join(root, ".git", CONTROL);
  try {
    fs.lstatSync(directory);
    throw Error(
      "release control already exists; choose a fresh seeded repository",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const f = sourceFrame(root),
    value = validateControl({
      synthetic: true,
      version: 1,
      instanceId: randomUUID(),
      rootIdentity: f.rootIdentity,
      population: null,
      provenance: {
        kind: "explicit_synthetic_release_author",
        priorModelEvidence: null,
        priorHumanAuthentication: null,
        priorPublication: null,
      },
      operations: [],
      reads: [],
      decisions: [],
    });
  fs.mkdirSync(directory, { mode: 0o700 });
  exclusive(
    path.join(directory, "control.json"),
    Buffer.from(JSON.stringify(value, null, 2) + "\n"),
  );
  return value;
}
export class ManagedRelease {
  constructor(root, runner, owner) {
    this.root = validateRoot(root);
    this.directory = path.join(this.root, ".git", CONTROL);
    if (
      !fs.lstatSync(this.directory).isDirectory() ||
      fs.lstatSync(this.directory).isSymbolicLink()
    )
      throw Error("managed release control required");
    this.file = path.join(this.directory, "control.json");
    this.lock = path.join(this.directory, "lock.sqlite");
    this.runner = runner;
    this.owner = owner;
    this.observed = new Map();
    this.instanceId = this.readControl().value.instanceId;
  }
  readControl() {
    const st = fs.lstatSync(this.directory);
    if (
      !st.isDirectory() ||
      st.isSymbolicLink() ||
      fs.realpathSync(this.directory) !== this.directory
    )
      throw Error("release control directory identity/alias changed");
    const source = readRegular(this.file),
      value = validateControl(parseJSON(source.text)),
      stat = fs.statSync(this.root);
    if (
      value.rootIdentity !== `${stat.dev}:${stat.ino}` ||
      (this.instanceId !== undefined && value.instanceId !== this.instanceId)
    )
      throw Error("managed release instance/root changed");
    const authoritySources = [],
      headerFile = path.join(this.directory, "population.json"),
      seedFile = path.join(this.directory, "population-seed.json");
    if (value.population) {
      const headerSource = readRegular(headerFile),
        header = populationHeader.parse(parseJSON(headerSource.text)),
        seed = readRegular(seedFile);
      if (
        header.instanceId !== value.instanceId ||
        !same(
          Object.fromEntries(
            Object.keys(populationReference.shape).map((k) => [k, header[k]]),
          ),
          value.population,
        ) ||
        seed.sha256 !== header.seedSha256
      )
        throw Error(
          "private population authority differs from original instance/source",
        );
      authoritySources.push(
        { path: "population.json", source: headerSource },
        { path: "population-seed.json", source: seed },
      );
    } else
      for (const file of [headerFile, seedFile])
        try {
          fs.lstatSync(file);
          throw Error("private population authority reference missing");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
    return { source, value, authoritySources };
  }
  transaction(handler) {
    this.readControl();
    if (
      fs.existsSync(this.lock) &&
      (!fs.lstatSync(this.lock).isFile() ||
        fs.lstatSync(this.lock).isSymbolicLink())
    )
      throw Error("invalid release mutex");
    try {
      fs.closeSync(fs.openSync(this.lock, "wx", 0o600));
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const db = new DatabaseSync(this.lock);
    try {
      db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
      const prior = this.readControl(),
        value = handler(prior);
      db.exec("COMMIT");
      return structuredClone(value);
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      db.close();
    }
  }
  save(prior, value, guard = () => {}) {
    validateControl(value);
    writeStaged(
      this.file,
      Buffer.from(JSON.stringify(value, null, 2) + "\n"),
      () => {
        guard();
        const current = this.readControl();
        if (
          current.source.sha256 !== prior.source.sha256 ||
          current.source.identity !== prior.source.identity
        )
          throw Error("release control changed before durable record");
      },
    );
    return this.readControl();
  }
  operation(c, credential, allowClosed = false) {
    if (credential === null) return null;
    if (typeof credential !== "string" || !/^[a-f0-9]{64}$/.test(credential))
      throw Error("unknown_operation");
    const op = c.operations.find(
      (o) => o.credentialSha256 === hash(credential),
    );
    if (!op) throw Error("unknown_operation");
    if (op.status !== "active" && !allowClosed) throw Error("operation_closed");
    return op;
  }
  scope(op) {
    return {
      kind: op ? "operator" : "synthetic_human",
      operationId: op?.id ?? null,
    };
  }
  register(taskSha256, allowWrites, intent = null) {
    hex.parse(taskSha256);
    if (typeof allowWrites !== "boolean")
      throw Error("explicit boolean permission required");
    if (allowWrites) intent = intentSchema.parse(intent);
    else if (intent !== null) throw Error("read-only intent must be null");
    return this.transaction((prior) => {
      if (prior.value.decisions.some((d) => d.status === "prepared"))
        throw Error("prepared_draft_outcome_unresolved");
      const credential = randomBytes(32).toString("hex"),
        operation = {
          id: randomUUID(),
          credentialSha256: hash(credential),
          taskSha256,
          allowWrites,
          intent,
          status: "active",
        },
        value = structuredClone(prior.value);
      value.operations.push(operation);
      this.save(prior, value);
      return { credential, operation };
    });
  }
  closeOperation(credential) {
    return this.transaction((prior) => {
      const op = this.operation(prior.value, credential);
      if (!op) throw Error("operator credential required");
      const value = structuredClone(prior.value);
      value.operations.find((o) => o.id === op.id).status = "closed";
      this.save(prior, value);
      return { operation: value.operations.find((o) => o.id === op.id) };
    });
  }
  knownDraft(control, files) {
    if (files.some((f) => f.kind !== "regular")) return null;
    return (
      [...control.decisions]
        .reverse()
        .find(
          (d) =>
            d.status === "applied" &&
            d.notesSha256 === files[0].sha256 &&
            d.metadataSha256 === files[1].sha256,
        ) ?? null
    );
  }
  clean(snapshot, control, files) {
    const known = this.knownDraft(control, files);
    return snapshot.business.status.every(
      (s) =>
        DRAFT_NAMES.includes(s.path) &&
        ["??", "!!"].includes(s.code) &&
        known &&
        known.sourceSha256 === snapshot.sourceSha256,
    );
  }
  async capture({ cleanup = false } = {}) {
    const snapshot = await inspectSnapshot(this.root, this.runner, { cleanup }),
      control = this.readControl(),
      files = draftFiles(this.root);
    return {
      snapshot,
      controlBodyBase64: control.source.bytes.toString("base64"),
      controlSha256: control.source.sha256,
      control: control.value,
      authorityImages: control.authoritySources.map(({ path, source }) => ({
        path,
        sha256: source.sha256,
        identity: source.identity,
        size: source.bytes.length,
      })),
      draftFiles: files,
      sourceClean: this.clean(snapshot, control.value, files),
    };
  }
  async inspect(credential = null) {
    this.owner?.basicGuard();
    const captured = await this.capture(),
      publicView = {
        ...captured.snapshot.business,
        clean: captured.sourceClean,
        draft: captured.draftFiles.map((f) => ({
          path: f.path,
          kind: f.kind,
          ...(f.kind === "regular" ? { sha256: f.sha256 } : {}),
        })),
      };
    if (Buffer.byteLength(JSON.stringify(publicView)) > 128 * 1024)
      throw Error("complete release observation exceeds model view bound");
    const result = this.transaction((prior) => {
      this.owner?.basicGuard();
      const op = this.operation(prior.value, credential),
        scope = this.scope(op);
      if (prior.value.decisions.some((d) => d.status === "prepared"))
        throw Error("prepared_draft_outcome_unresolved");
      if (!same(sourceFrame(this.root), captured.snapshot.frame))
        throw Error("repository changed before observed read");
      const r = {
        id: randomUUID(),
        instanceId: this.instanceId,
        scope,
        source: captured.snapshot,
        contentSha256: "",
      };
      r.contentSha256 = readHash(r);
      const value = structuredClone(prior.value);
      value.reads.push(r);
      this.save(prior, value, () => {
        this.owner?.basicGuard();
        if (!same(sourceFrame(this.root), captured.snapshot.frame))
          throw Error("repository changed while observing");
      });
      return { read: r, scope };
    });
    this.observed.set(result.scope.operationId ?? "human", result.read.id);
    return publicView;
  }
  async prepare(input, credential = null) {
    const args = draftArgs.safeParse(input);
    if (!args.success) return { error: "invalid_draft_arguments" };
    this.owner?.basicGuard();
    const captured = await this.capture();
    return this.transaction((prior) => {
      this.owner?.basicGuard();
      const op = this.operation(prior.value, credential),
        scope = this.scope(op),
        source = captured.snapshot;
      if (
        op &&
        (!op.allowWrites || !same(op.intent, intentFor(source.business)))
      )
        return { error: "writes_not_authorized" };
      if (prior.value.decisions.some((d) => d.status === "prepared"))
        return { error: "prepared_draft_outcome_unresolved" };
      const r = prior.value.reads.find(
        (r) => r.id === this.observed.get(scope.operationId ?? "human"),
      );
      if (!r || r.instanceId !== this.instanceId || !same(r.scope, scope))
        return { error: "genuine_current_inspection_required" };
      if (prior.value.decisions.some((d) => d.readId === r.id))
        return { error: "inspection_already_consumed" };
      if (
        r.source.sourceSha256 !== source.sourceSha256 ||
        !same(sourceFrame(this.root), source.frame)
      )
        return { error: "repository_changed_since_inspection" };
      if (!same(r.source.drafts, source.drafts))
        return { error: "draft_changed_since_inspection" };
      if (
        !same(args.data, {
          version: source.business.nextVersion,
          baseTag: source.business.baseTag,
          expectedHead: source.business.head,
          commitIds: source.business.commits.map((c) => c.id),
        })
      )
        return { error: "draft_arguments_differ_from_current_source" };
      const files = draftFiles(this.root),
        known = this.knownDraft(prior.value, files);
      if (!same(files, source.drafts))
        return { error: "draft_changed_before_commit" };
      if (!this.clean(source, prior.value, files))
        return { error: "dirty_repository" };
      if (
        files.some((f) => f.kind !== "absent") &&
        (!known || known.sourceSha256 !== source.sourceSha256)
      )
        return { error: "foreign_or_stale_draft" };
      const id = randomUUID(),
        unchanged = !!known,
        content = unchanged
          ? {
              notes: body(known.notesBase64, known.notesSha256),
              metadata: body(known.metadataBase64, known.metadataSha256),
            }
          : draftContent(source, id, this.instanceId),
        decision = {
          id,
          sequence: prior.value.decisions.length + 1,
          instanceId: this.instanceId,
          scope,
          readId: r.id,
          sourceSha256: source.sourceSha256,
          args: args.data,
          source: r.source,
          notesBase64: content.notes.toString("base64"),
          metadataBase64: content.metadata.toString("base64"),
          notesSha256: hash(content.notes),
          metadataSha256: hash(content.metadata),
          status: unchanged ? "unchanged" : "prepared",
          referencedDecisionId: known?.id ?? null,
        },
        value = structuredClone(prior.value);
      value.decisions.push(decision);
      const guard = () => {
        this.owner?.basicGuard();
        this.operation(this.readControl().value, credential);
        if (!same(sourceFrame(this.root), source.frame))
          throw Error("repository changed before local draft commit");
      };
      let current = this.save(prior, value, guard);
      if (!unchanged)
        try {
          for (const [n, name] of DRAFT_NAMES.entries())
            exclusive(
              path.join(this.root, name),
              n ? content.metadata : content.notes,
              () => {
                guard();
                if (n) {
                  const first = draftFiles(this.root)[0];
                  if (
                    first.kind !== "regular" ||
                    first.sha256 !== decision.notesSha256
                  )
                    throw Error(
                      "first draft file changed before metadata write",
                    );
                }
              },
            );
          const written = draftFiles(this.root);
          if (
            written[0].sha256 !== decision.notesSha256 ||
            written[1].sha256 !== decision.metadataSha256
          )
            throw Error("draft files differ after separate commits");
          const finished = structuredClone(current.value);
          finished.decisions.find((d) => d.id === id).status = "applied";
          this.save(current, finished, guard);
        } catch (e) {
          let actual = null,
            observationError = null;
          try {
            actual = draftFiles(this.root);
          } catch (observation) {
            observationError = observation.message;
          }
          e.partialDraft = {
            decisionId: id,
            plannedNotesSha256: decision.notesSha256,
            plannedMetadataSha256: decision.metadataSha256,
            actual,
            observationError,
            status: "prepared/unknown; no automatic recovery or publication",
          };
          throw e;
        }
      this.observed.delete(scope.operationId ?? "human");
      return {
        unchanged,
        decisionId: id,
        metadata: parseJSON(content.metadata.toString("utf8")),
        notes: content.notes.toString("utf8"),
        publicationStatus: "draft",
      };
    });
  }
  async readDraft(credential = null) {
    this.owner?.basicGuard();
    const c = await this.capture();
    this.operation(c.control, credential);
    if (c.control.decisions.some((d) => d.status === "prepared"))
      throw Error("prepared_draft_outcome_unresolved");
    const known = this.knownDraft(c.control, c.draftFiles);
    if (
      !known ||
      known.sourceSha256 !== c.snapshot.sourceSha256 ||
      !c.sourceClean
    )
      throw Error("unverified_stale_or_foreign_draft");
    return {
      metadata: metadataSchema.parse(
        parseJSON(
          body(known.metadataBase64, known.metadataSha256).toString("utf8"),
        ),
      ),
      notes: body(known.notesBase64, known.notesSha256).toString("utf8"),
      publicationStatus: "draft",
      git: {
        head: c.snapshot.business.head,
        baseCommit: c.snapshot.business.baseCommit,
        tags: c.snapshot.business.tags,
        remotes: [],
      },
      origin: {
        kind: known.scope.kind,
        operationId: known.scope.operationId,
        decisionId: known.id,
      },
    };
  }
}

export function businessResult(name, value) {
  if (value?.error) return { error: value.error };
  if (name === "inspect_release") return value;
  const meta = value.metadata;
  if (!meta) throw Error("complete local draft metadata required");
  const fields = [
    "version",
    "baseTag",
    "baseCommit",
    "head",
    "commitIds",
    "publicationStatus",
    "notesFile",
    "manifestSha256",
    "notesSha256",
  ];
  return {
    metadata: Object.fromEntries(fields.map((k) => [k, meta[k]])),
    notes: value.notes,
    publicationStatus: "draft",
    ...(name === "prepare_release_draft"
      ? { unchanged: value.unchanged }
      : { tags: value.git.tags, remotes: [], git: value.git }),
  };
}
