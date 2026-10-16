import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function readRegular(file, { binary = false } = {}) {
  const initial = fs.lstatSync(file);
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size > 8 * 1024 * 1024
  )
    throw Error("bounded regular release file required");
  const fd = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(fd),
      bytes = fs.readFileSync(fd),
      after = fs.fstatSync(fd),
      current = fs.lstatSync(file);
    if (
      bytes.length > 8 * 1024 * 1024 ||
      initial.dev !== before.dev ||
      initial.ino !== before.ino ||
      before.dev !== current.dev ||
      before.ino !== current.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.length !== before.size
    )
      throw Error("release file changed while reading");
    return {
      bytes,
      text: binary
        ? null
        : new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      sha256: hash(bytes),
      identity: `${before.dev}:${before.ino}`,
    };
  } finally {
    fs.closeSync(fd);
  }
}
export function writeStaged(file, bytes, guard) {
  if (bytes.length > 8 * 1024 * 1024) throw Error("release source size limit");
  const temp = path.join(path.dirname(file), `.release-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    guard();
    fs.renameSync(temp, file);
    const parent = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
