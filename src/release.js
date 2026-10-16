import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { parseJSON } from "./json.js";
import { readRegular, hash } from "./source.js";
import { stableVersion, deriveVersion } from "./version.js";
const oid = z.string().regex(/^[a-f0-9]{40}$/),
  version = z.string().refine((v) => {
    try {
      stableVersion(v);
      return true;
    } catch {
      return false;
    }
  }),
  manifestSchema = z
    .object({
      name: z
        .string()
        .min(1)
        .max(160)
        .refine((v) => v.isWellFormed() && !/[\x00-\x1f\x7f]/.test(v)),
      version,
      private: z.literal(true),
    })
    .passthrough();
const draftSchema = z.strictObject({
  version,
  baseTag: z.string().min(2).max(80),
  baseCommit: oid,
  head: oid,
  commitIds: z.array(oid).min(1).max(1000),
  publicationStatus: z.literal("draft"),
  notesFile: z.literal("CHANGELOG.draft.md"),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  notesSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const env = () => ({
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
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_LITERAL_PATHSPECS: "1",
});
const names = ["CHANGELOG.draft.md", "release-draft.json"];
function notesFor(s, version) {
  return `# ${s.repository} v${version}\n\nDraft release notes. Publication is separate.\n\n## Changes since ${s.baseTag}\n\n${s.commits.map((c) => `- ${c.subject} (${c.id.slice(0, 7)})`).join("\n")}\n`;
}
export class ReleaseRepo {
  constructor(root) {
    this.root = fs.realpathSync(path.resolve(root));
    const marker = path.join(this.root, ".firedrill-release-sample");
    try {
      if (readRegular(marker).text !== "synthetic release sample\n")
        throw Error("invalid marker");
      const git = fs.lstatSync(path.join(this.root, ".git"));
      if (!git.isDirectory() || git.isSymbolicLink())
        throw Error("exact Git directory required");
    } catch (e) {
      throw Error(
        "only an exact seeded synthetic release repository is supported",
        { cause: e },
      );
    }
    if (
      fs.realpathSync(this.git(["rev-parse", "--show-toplevel"])) !== this.root
    )
      throw Error("Git root differs from exact seeded repository");
    if (this.git(["rev-parse", "--show-object-format"]) !== "sha1")
      throw Error("only qualified SHA1 fixture repositories are supported");
    this.assertLocalGit();
  }
  assertLocalGit() {
    for (const name of [
      "shallow",
      "objects/info/alternates",
      "info/grafts",
      "commondir",
      "refs/replace",
    ]) {
      try {
        fs.lstatSync(path.join(this.root, ".git", name));
        throw Error("unsupported incomplete/shared/replaced Git source");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    for (const name of ["config", "objects", "refs"]) {
      const st = fs.lstatSync(path.join(this.root, ".git", name));
      if (
        st.isSymbolicLink() ||
        (name === "config" ? !st.isFile() : !st.isDirectory())
      )
        throw Error("regular local Git control paths required");
    }
    if (this.git(["remote"]))
      throw Error(
        "only local seeded repositories without remotes are supported",
      );
  }
  gitBytes(args) {
    return execFileSync(
      "git",
      [
        "--no-pager",
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
        env: env(),
        stdio: "pipe",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
  }
  git(args) {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(this.gitBytes(args))
      .trim();
  }
  inspect() {
    this.assertLocalGit();
    this.git(["fsck", "--strict", "--no-dangling"]);
    const original = readRegular(path.join(this.root, "package.json")),
      manifest = manifestSchema.parse(parseJSON(original.text)),
      baseTag = "v" + manifest.version,
      baseTagObject = oid.parse(
        this.git(["rev-parse", "--verify", "refs/tags/" + baseTag]),
      ),
      baseCommit = oid.parse(
        this.git([
          "rev-parse",
          "--verify",
          "refs/tags/" + baseTag + "^{commit}",
        ]),
      ),
      head = oid.parse(this.git(["rev-parse", "HEAD"])),
      range = `${baseCommit}..${head}`;
    try {
      this.git(["merge-base", "--is-ancestor", baseCommit, head]);
    } catch (e) {
      throw Error("release base must be an ancestor of current HEAD", {
        cause: e,
      });
    }
    const status = this.git(["status", "--porcelain"]),
      raw = new TextDecoder("utf-8", { fatal: true }).decode(
        this.gitBytes([
          "log",
          "--topo-order",
          "--format=%H%x00%P%x00%B",
          "-z",
          range,
        ]),
      );
    if (raw && !raw.endsWith("\0"))
      throw Error("incomplete full commit framing");
    const fields = raw ? raw.slice(0, -1).split("\0") : [];
    if (fields.length % 3) throw Error("ambiguous full commit framing");
    const commits = [];
    for (let n = 0; n < fields.length; n += 3) {
      const id = oid.parse(fields[n]),
        parents = fields[n + 1]
          ? fields[n + 1].split(" ").map((v) => oid.parse(v))
          : [],
        message = fields[n + 2],
        subject = message.split("\n", 1)[0].replace(/\r$/, "");
      commits.push({ id, parents, subject, message });
    }
    const ids = this.git(["rev-list", "--topo-order", range])
      .split("\n")
      .filter(Boolean);
    if (
      new Set(commits.map((c) => c.id)).size !== commits.length ||
      JSON.stringify(ids) !== JSON.stringify(commits.map((c) => c.id))
    )
      throw Error("full commit observations differ from actual complete graph");
    const policy = deriveVersion(manifest.version, commits);
    return {
      repository: manifest.name,
      currentVersion: manifest.version,
      baseTag,
      baseTagObject,
      baseCommit,
      head,
      manifestSha256: original.sha256,
      clean: !status,
      dirtyPaths: status.split("\n").filter(Boolean),
      commits,
      ...policy,
      remotes: this.git(["remote"]).split("\n").filter(Boolean),
    };
  }
  prepareDraft(input) {
    const args = z
      .strictObject({
        version,
        baseTag: z.string().min(2).max(80),
        expectedHead: oid,
        commitIds: z.array(oid).min(1).max(1000),
      })
      .safeParse(input);
    if (!args.success) return { error: "invalid_draft_arguments" };
    const { version: requested, baseTag, expectedHead, commitIds } = args.data,
      state = this.inspect();
    if (!state.clean)
      return { error: "dirty_repository", paths: state.dirtyPaths };
    if (state.head !== expectedHead) return { error: "head_changed" };
    if (state.baseTag !== baseTag) return { error: "wrong_base_tag" };
    if (state.nextVersion !== requested)
      return { error: "wrong_version", expected: state.nextVersion };
    if (
      commitIds.length !== state.commits.length ||
      state.commits.some((c, n) => c.id !== commitIds[n])
    )
      return {
        error: "missing_or_extra_commits",
        expectedIds: state.commits.map((c) => c.id),
      };
    for (const name of names)
      try {
        fs.lstatSync(path.join(this.root, name));
        return { error: "draft_destination_exists" };
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    const notes = notesFor(state, requested),
      metadata = draftSchema.parse({
        version: requested,
        baseTag,
        baseCommit: state.baseCommit,
        head: state.head,
        commitIds,
        publicationStatus: "draft",
        notesFile: names[0],
        manifestSha256: state.manifestSha256,
        notesSha256: hash(Buffer.from(notes)),
      });
    fs.writeFileSync(path.join(this.root, names[0]), notes, {
      flag: "wx",
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(this.root, names[1]),
      JSON.stringify(metadata, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return { notes, metadata };
  }
  readDraft() {
    const metadata = draftSchema.parse(
        parseJSON(readRegular(path.join(this.root, names[1])).text),
      ),
      notes = readRegular(path.join(this.root, names[0])).text,
      state = this.inspect();
    if (
      state.head !== metadata.head ||
      state.baseCommit !== metadata.baseCommit ||
      state.baseTag !== metadata.baseTag ||
      state.nextVersion !== metadata.version ||
      state.manifestSha256 !== metadata.manifestSha256 ||
      JSON.stringify(state.commits.map((c) => c.id)) !==
        JSON.stringify(metadata.commitIds) ||
      hash(Buffer.from(notes)) !== metadata.notesSha256 ||
      notes !== notesFor(state, metadata.version)
    )
      throw Error(
        "draft differs from exact current source or original expected content",
      );
    if (state.dirtyPaths.some((p) => !names.some((n) => p === "?? " + n)))
      throw Error("unrelated dirty source cannot verify a draft");
    return {
      metadata,
      notes,
      gitStatus: this.git(["status", "--porcelain"]),
      tags: this.git(["tag", "--list"]).split("\n").filter(Boolean),
      sourceValidation:
        "current draft content/context verified; original operation authorship is not attested yet",
    };
  }
}
