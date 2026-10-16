/** Complete bounded regular source image; controller state and fixed draft outputs are separate. */
import fs from "node:fs";
import path from "node:path";
import { hash, readRegular } from "./source.js";
export const CONTROL = "firedrill-release";
export const DRAFT_NAMES = ["CHANGELOG.draft.md", "release-draft.json"];
export const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export const digest = (v) => hash(canonical(v)),
  same = (a, b) => canonical(a) === canonical(b);
export function validateRoot(root) {
  root = fs.realpathSync(path.resolve(root));
  if (!fs.lstatSync(root).isDirectory())
    throw Error("exact synthetic repository directory required");
  if (
    readRegular(path.join(root, ".firedrill-release-sample")).text !==
    "synthetic release sample\n"
  )
    throw Error("exact synthetic marker required");
  for (const name of [".git", ".git/objects", ".git/refs"]) {
    const stat = fs.lstatSync(path.join(root, name));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("regular local Git directory required");
  }
  const config = readRegular(path.join(root, ".git/config"));
  if (/^\s*\[(?:include|includeif)(?:\s|\])/im.test(config.text))
    throw Error("Git includes are unsupported");
  for (const name of [
    "shallow",
    "objects/info/alternates",
    "info/grafts",
    "commondir",
    "refs/replace",
  ])
    try {
      fs.lstatSync(path.join(root, ".git", name));
      throw Error("shared/incomplete/replaced Git store unsupported");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  return root;
}
export function sourceFrame(root) {
  validateRoot(root);
  const files = [];
  let bytes = 0;
  function walk(relative) {
    if (relative === `.git/${CONTROL}` || DRAFT_NAMES.includes(relative))
      return;
    const full = path.join(root, relative),
      stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw Error("source symlink unsupported");
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort())
        walk(relative ? relative + "/" + name : name);
      return;
    }
    if (!stat.isFile() || files.length >= 4096)
      throw Error("bounded regular source required");
    const source = readRegular(full, { binary: true });
    bytes += source.bytes.length;
    if (bytes > 16 * 1024 * 1024)
      throw Error("complete source image exceeds16MiB");
    files.push({
      path: relative,
      bodyBase64: source.bytes.toString("base64"),
      sha256: source.digest ?? source.sha256,
      size: source.bytes.length,
      mode: stat.mode & 0o777,
      identity: source.identity,
    });
  }
  for (const name of fs.readdirSync(root).sort()) walk(name);
  const stat = fs.statSync(root);
  return {
    rootIdentity: `${stat.dev}:${stat.ino}`,
    files,
    sha256: digest(files),
    bytes,
  };
}
export function draftFiles(root) {
  return DRAFT_NAMES.map((name) => {
    try {
      const stat = fs.lstatSync(path.join(root, name));
      if (!stat.isFile() || stat.isSymbolicLink())
        return { path: name, kind: "unsupported" };
      const r = readRegular(path.join(root, name));
      return {
        path: name,
        kind: "regular",
        bodyBase64: r.bytes.toString("base64"),
        sha256: r.sha256,
        size: r.bytes.length,
        identity: r.identity,
        mode: stat.mode & 0o777,
      };
    } catch (e) {
      if (e.code === "ENOENT") return { path: name, kind: "absent" };
      throw e;
    }
  });
}
