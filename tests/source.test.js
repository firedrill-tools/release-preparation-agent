import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seed } from "../scripts/seed.js";
import { ReleaseRepo } from "../src/release.js";
import { deriveVersion, stableVersion } from "../src/version.js";
function setup(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "release-source-")),
    root = seed(path.join(parent, "repository"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, repo: new ReleaseRepo(root) };
}
const args = (s) => ({
  version: s.nextVersion,
  baseTag: s.baseTag,
  expectedHead: s.head,
  commitIds: s.commits.map((c) => c.id),
});
function commit(repo, subject, body) {
  fs.writeFileSync(path.join(repo.root, "extra.txt"), "synthetic change\n");
  repo.git(["add", "extra.txt"]);
  repo.git(["commit", "-m", subject, ...(body ? ["-m", body] : [])]);
}
for (const kind of ["scoped-header", "footer"])
  test(`actual full Git ${kind} breaking change derives major version and complete notes`, (t) => {
    const { repo } = setup(t);
    if (kind === "scoped-header")
      commit(repo, "feat(api)!: remove legacy format");
    else
      commit(
        repo,
        "refactor: replace format",
        "BREAKING CHANGE: clients must supply the new shape.",
      );
    const s = repo.inspect();
    assert.equal(s.nextVersion, "2.0.0");
    assert.equal(s.bump, "major");
    assert.equal(s.commits.length, 4);
    if (kind === "footer")
      assert.match(s.commits[0].message, /BREAKING CHANGE/);
    assert.equal(repo.prepareDraft(args(s)).metadata.version, "2.0.0");
  });
test("explicit version policy handles scoped/case-insensitive features any breaking type synonym footer and declared fallback", () => {
  for (const [message, expected] of [
    ["feat(parser): add format", "1.5.0"],
    ["FEAT(api): add format", "1.5.0"],
    ["refactor(api)!: alter shape", "2.0.0"],
    ["perf: faster\n\nBREAKING-CHANGE: API shape changed.", "2.0.0"],
    ["docs: update copy", "1.4.1"],
  ]) {
    const result = deriveVersion("1.4.0", [{ id: "a".repeat(40), message }]);
    assert.equal(result.nextVersion, expected);
    assert.equal(result.policy.default_bump, "patch");
  }
});
test("canonical stable components reject malformed/coerced/unsafe versions and overflow without clamping", () => {
  for (const value of [
    "1.2.3.4",
    "01.2.3",
    "-1.2.3",
    "1e0.2.3",
    "1.2.3-rc.1",
    "1.2.9007199254740992",
    true,
  ])
    assert.throws(() => stableVersion(value));
  assert.throws(
    () =>
      deriveVersion("1.9007199254740991.0", [
        { id: "a".repeat(40), message: "feat: next" },
      ]),
    /version_exhausted/,
  );
  assert.equal(
    deriveVersion("1.9007199254740991.0", [
      { id: "a".repeat(40), message: "feat!: replace" },
    ]).nextVersion,
    "2.0.0",
  );
});
test("nested copied marker cannot borrow parent Git history as another repository", (t) => {
  const { repo, root } = setup(t),
    nested = path.join(root, "nested");
  fs.mkdirSync(nested);
  fs.writeFileSync(
    path.join(nested, ".firedrill-release-sample"),
    "synthetic release sample\n",
  );
  fs.writeFileSync(
    path.join(nested, "package.json"),
    JSON.stringify({
      name: "another-project",
      version: "1.4.0",
      private: true,
    }),
  );
  repo.git(["add", "nested"]);
  repo.git(["commit", "-m", "chore: nested fixture"]);
  assert.throws(() => new ReleaseRepo(nested), /exact seeded synthetic/);
});
test("actual nonancestor release tag fails before any draft file", (t) => {
  const { repo, root } = setup(t),
    tree = repo.git(["write-tree"]),
    orphan = repo.git(["commit-tree", tree, "-m", "unrelated base"]);
  repo.git(["tag", "-f", "v1.4.0", orphan]);
  assert.throws(() => repo.inspect(), /ancestor/);
  assert.equal(fs.existsSync(path.join(root, "release-draft.json")), false);
});
test("ignored draft symlink cannot overwrite an outside owned synthetic file", (t) => {
  const { repo, root, parent } = setup(t),
    outside = path.join(parent, "outside.txt");
  fs.writeFileSync(outside, "preserve unrelated source\n");
  fs.symlinkSync(outside, path.join(root, "CHANGELOG.draft.md"));
  fs.appendFileSync(
    path.join(root, ".git/info/exclude"),
    "\nCHANGELOG.draft.md\nrelease-draft.json\n",
  );
  const s = repo.inspect();
  assert.equal(s.clean, true);
  assert.equal(repo.prepareDraft(args(s)).error, "draft_destination_exists");
  assert.equal(fs.readFileSync(outside, "utf8"), "preserve unrelated source\n");
  assert.equal(fs.existsSync(path.join(root, "release-draft.json")), false);
});
test("forged published or wrong-source metadata cannot be read as a verified local draft", (t) => {
  const { repo, root } = setup(t);
  repo.prepareDraft(args(repo.inspect()));
  const file = path.join(root, "release-draft.json"),
    original = JSON.parse(fs.readFileSync(file));
  for (const change of [
    (x) => (x.publicationStatus = "published"),
    (x) => (x.head = "0".repeat(40)),
    (x) => (x.commitIds = []),
    (x) => (x.version = "999.0.0"),
  ]) {
    const value = structuredClone(original);
    change(value);
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => repo.readDraft());
  }
  assert.deepEqual(repo.git(["tag", "--list"]), "v1.4.0");
});
test("tampered notes and duplicate metadata keys reject without repair", (t) => {
  const { repo, root } = setup(t);
  repo.prepareDraft(args(repo.inspect()));
  const file = path.join(root, "release-draft.json"),
    raw = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, raw.replace("{", '{"publicationStatus":"published",'));
  const before = fs.readFileSync(file);
  assert.throws(() => repo.readDraft(), /duplicate/);
  assert.deepEqual(fs.readFileSync(file), before);
  fs.writeFileSync(file, raw);
  fs.appendFileSync(
    path.join(root, "CHANGELOG.draft.md"),
    "Invented extra claims",
  );
  assert.throws(() => repo.readDraft(), /draft differs/);
  assert.match(
    fs.readFileSync(path.join(root, "CHANGELOG.draft.md"), "utf8"),
    /Invented extra claims/,
  );
});
test("full tab-containing subject/body are retained with complete actual commit graph", (t) => {
  const { repo } = setup(t);
  commit(
    repo,
    "fix: preserve\ttab data",
    "Full body with customer-visible detail.",
  );
  const s = repo.inspect();
  assert.match(s.commits[0].subject, /preserve\ttab data/);
  assert.match(s.commits[0].message, /Full body/);
  assert.equal(s.commits[0].parents.length, 1);
  assert.equal(s.commits.length, 4);
});
test("original duplicate or non-UTF8 manifest fails before drafting", (t) => {
  const { repo, root } = setup(t),
    file = path.join(root, "package.json"),
    raw = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, raw.replace("{", '{"version":"9.0.0",'));
  assert.throws(() => repo.inspect(), /duplicate/);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(raw), Buffer.from([255])]));
  assert.throws(() => repo.inspect());
  assert.equal(fs.existsSync(path.join(root, "release-draft.json")), false);
});
test("unsafe complete source version cannot create an overflowed draft", (t) => {
  const { repo, root } = setup(t),
    file = path.join(root, "package.json"),
    manifest = JSON.parse(fs.readFileSync(file));
  manifest.version = "1.9007199254740991.0";
  fs.writeFileSync(file, JSON.stringify(manifest));
  repo.git(["add", "package.json"]);
  repo.git(["commit", "-m", "chore: maximum version"]);
  repo.git(["tag", "v" + manifest.version]);
  commit(repo, "feat: next");
  assert.throws(() => repo.inspect(), /version_exhausted/);
  assert.equal(fs.existsSync(path.join(root, "release-draft.json")), false);
});
test("unknown draft arguments cannot be normalized by the public source method", (t) => {
  const { repo } = setup(t),
    s = repo.inspect();
  assert.equal(
    repo.prepareDraft({ ...args(s), publish: true }).error,
    "invalid_draft_arguments",
  );
  assert.equal(
    repo.prepareDraft({ ...args(s), expectedHead: true }).error,
    "invalid_draft_arguments",
  );
  assert.equal(repo.inspect().clean, true);
});
test("a local remote or incomplete/shared Git store is rejected before release scope traversal", (t) => {
  const { repo, root } = setup(t);
  repo.git(["remote", "add", "origin", "https://example.invalid/synthetic"]);
  assert.throws(() => repo.inspect(), /without remotes/);
  repo.git(["remote", "remove", "origin"]);
  fs.writeFileSync(
    path.join(root, ".git/objects/info/alternates"),
    "/outside-unsupported\n",
  );
  assert.throws(() => repo.inspect(), /incomplete\/shared/);
});
