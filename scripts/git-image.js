/** Trusted fictional fixture author: portable original loose Git objects/index.
 * No model tool imports this module. Real Git validates/reads delivered images.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hash } from "../src/source.js";
const sha1 = (b) => createHash("sha1").update(b).digest("hex");
const ordered = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function deflateStored(raw) {
  const parts = [Buffer.from([0x78, 0x01])];
  for (let n = 0; n < raw.length; n += 65535) {
    const block = raw.subarray(n, n + 65535),
      header = Buffer.alloc(5);
    header[0] = n + block.length === raw.length ? 1 : 0;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(block.length ^ 0xffff, 3);
    parts.push(header, block);
  }
  let a = 1,
    b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE((b * 65536 + a) >>> 0);
  parts.push(footer);
  return Buffer.concat(parts);
}
function sourcePath(name) {
  if (
    typeof name !== "string" ||
    !name.isWellFormed() ||
    name
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p === ".git") ||
    name.includes("\0") ||
    name.includes("\\")
  )
    throw Error("regular relative fixture path required");
  return name;
}
export class GitImage {
  constructor() {
    this.objects = new Map();
    this.commits = new Map();
    this.tags = new Map();
    this.branches = new Map();
    this.head = null;
    this.tick = 0;
  }
  object(type, body) {
    body = Buffer.from(body);
    const raw = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]),
      id = sha1(raw);
    this.objects.set(id, { type, body, compressed: deflateStored(raw) });
    return id;
  }
  tree(files) {
    const root = Object.create(null);
    for (const [name, body] of files) {
      const parts = sourcePath(name).split("/");
      let node = root;
      for (const part of parts.slice(0, -1)) {
        node[part] ??= Object.create(null);
        if (Buffer.isBuffer(node[part])) throw Error("fixture tree collision");
        node = node[part];
      }
      node[parts.at(-1)] = body;
    }
    const build = (node) => {
      const entries = Object.entries(node)
        .map(([name, value]) => {
          const directory = !Buffer.isBuffer(value),
            id = directory ? build(value) : this.object("blob", value);
          return { name, directory, id };
        })
        .sort((a, b) =>
          ordered(
            a.name + (a.directory ? "/" : ""),
            b.name + (b.directory ? "/" : ""),
          ),
        );
      return this.object(
        "tree",
        Buffer.concat(
          entries.map((e) =>
            Buffer.concat([
              Buffer.from(`${e.directory ? "40000" : "100644"} ${e.name}\0`),
              Buffer.from(e.id, "hex"),
            ]),
          ),
        ),
      );
    };
    return build(root);
  }
  commit(
    changes,
    message,
    { parents = this.head ? [this.head] : [], branch = "main" } = {},
  ) {
    if (
      typeof message !== "string" ||
      !message.isWellFormed() ||
      message.includes("\0")
    )
      throw Error("original UTF8 commit message required");
    if (
      !/^[a-z][a-z0-9/-]*$/.test(branch) ||
      branch.includes("..") ||
      branch.endsWith("/")
    )
      throw Error("fixture branch required");
    for (const id of parents)
      if (!this.commits.has(id)) throw Error("known actual parent required");
    const files = new Map(
      parents.length ? this.commits.get(parents[0]).files : [],
    );
    for (const [name, value] of Object.entries(changes)) {
      sourcePath(name);
      if (value === null) files.delete(name);
      else files.set(name, Buffer.from(value));
    }
    const tree = this.tree(files),
      time = 1790856000 + this.tick++ * 60,
      person = `Firedrill Fixture <fixture@firedrill.example> ${time} +0000`,
      body = `tree ${tree}\n${parents.map((id) => "parent " + id + "\n").join("")}author ${person}\ncommitter ${person}\n\n${message.replace(/\n*$/, "")}\n`,
      id = this.object("commit", body);
    this.commits.set(id, {
      id,
      tree,
      parents: [...parents],
      files,
      message: message.replace(/\n*$/, "") + "\n",
      time,
    });
    this.branches.set(branch, id);
    if (branch === "main") this.head = id;
    return id;
  }
  tag(name, id = this.head, { annotated = false } = {}) {
    if (
      !/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(
        name,
      ) ||
      !this.commits.has(id) ||
      this.tags.has(name)
    )
      throw Error("unique stable fixture tag/commit required");
    const object = annotated
      ? this.object(
          "tag",
          `object ${id}\ntype commit\ntag ${name}\ntagger Firedrill Fixture <fixture@firedrill.example> ${this.commits.get(id).time} +0000\n\nExplicit fictional release ${name}. Prior publication unknown.\n`,
        )
      : id;
    this.tags.set(name, { object, commit: id });
    return object;
  }
  index() {
    const files = this.commits.get(this.head).files,
      header = Buffer.alloc(12);
    header.write("DIRC");
    header.writeUInt32BE(2, 4);
    header.writeUInt32BE(files.size, 8);
    const parts = [header];
    for (const [name, body] of [...files].sort(([a], [b]) => ordered(a, b))) {
      const bytes = Buffer.from(name),
        entry = Buffer.alloc(Math.ceil((62 + bytes.length + 1) / 8) * 8);
      entry.writeUInt32BE(0o100644, 24);
      Buffer.from(this.object("blob", body), "hex").copy(entry, 40);
      entry.writeUInt16BE(Math.min(bytes.length, 0xfff), 60);
      bytes.copy(entry, 62);
      parts.push(entry);
    }
    const raw = Buffer.concat(parts);
    return Buffer.concat([raw, Buffer.from(sha1(raw), "hex")]);
  }
  image() {
    if (!this.head) throw Error("fixture needs current HEAD");
    const source = new Map(this.commits.get(this.head).files);
    source.set(".git/HEAD", Buffer.from("ref: refs/heads/main\n"));
    source.set(
      ".git/config",
      Buffer.from(
        "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = false\n[user]\n\tname = Firedrill Fixture\n\temail = fixture@firedrill.example\n",
      ),
    );
    source.set(".git/info/exclude", Buffer.alloc(0));
    source.set(".git/index", this.index());
    for (const [name, id] of this.branches)
      source.set(".git/refs/heads/" + name, Buffer.from(id + "\n"));
    for (const [name, t] of this.tags)
      source.set(".git/refs/tags/" + name, Buffer.from(t.object + "\n"));
    for (const [id, o] of this.objects)
      source.set(
        ".git/objects/" + id.slice(0, 2) + "/" + id.slice(2),
        o.compressed,
      );
    return [...source]
      .sort(([a], [b]) => ordered(a, b))
      .map(([name, bytes]) => ({
        path: name,
        bodyBase64: bytes.toString("base64"),
        sha256: hash(bytes),
        size: bytes.length,
        mode: 0o600,
      }));
  }
}
export function writeImage(root, image) {
  if (
    !Array.isArray(image) ||
    image.length > 4096 ||
    new Set(image.map((f) => f.path)).size !== image.length
  )
    throw Error("bounded unique original fixture files required");
  let bytes = 0;
  const decoded = image.map((f) => {
    if (
      typeof f.path !== "string" ||
      !f.path.isWellFormed() ||
      f.path.split("/").some((p) => !p || p === "." || p === "..") ||
      /[\x00-\x1f\\]/.test(f.path) ||
      f.path.startsWith(".git/firedrill-release") ||
      f.mode !== 0o600
    )
      throw Error("fixed regular relative fixture file required");
    const raw = Buffer.from(f.bodyBase64, "base64");
    bytes += raw.length;
    if (
      raw.toString("base64") !== f.bodyBase64 ||
      hash(raw) !== f.sha256 ||
      raw.length !== f.size ||
      raw.length > 8 * 1024 * 1024 ||
      bytes > 16 * 1024 * 1024
    )
      throw Error("original bounded fixture image differs");
    return { ...f, raw };
  });
  fs.mkdirSync(root, { mode: 0o700 });
  for (const f of decoded) {
    const target = path.join(root, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(target, "wx", f.mode);
    try {
      fs.writeFileSync(fd, f.raw);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  for (const name of ["objects", "refs", "refs/heads", "refs/tags"])
    fs.mkdirSync(path.join(root, ".git", name), {
      recursive: true,
      mode: 0o700,
    });
  function flush(directory) {
    for (const name of fs.readdirSync(directory)) {
      const full = path.join(directory, name);
      if (fs.lstatSync(full).isDirectory()) flush(full);
    }
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  flush(root);
  return fs.realpathSync(root);
}
