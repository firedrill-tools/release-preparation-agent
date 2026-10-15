import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { seed } from "../scripts/seed.js";
import { ReleaseRepo } from "../src/release.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-test-")); const repoPath = seed(path.join(dir, "workspace")); return { dir, repoPath, repo: new ReleaseRepo(repoPath) }; }
const argsFor = (state) => ({ version: state.nextVersion, baseTag: state.baseTag, expectedHead: state.head, commitIds: state.commits.map((item) => item.id) });
const body = (result) => JSON.parse(result.content[0].text);
async function connect(repoPath, allowWrites) {
  const client = new Client({ name: "offline-release-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "src/mcp-server.js"), "--repo", repoPath, ...(allowWrites ? ["--allow-writes"] : [])] });
  await client.connect(transport);
  return { client, call: async (name, args = {}) => client.callTool({ name, arguments: args }) };
}

test("seeded Git history derives complete release scope and exact version", () => {
  const { repo } = setup(); const state = repo.inspect();
  assert.equal(state.baseTag, "v1.4.0"); assert.equal(state.nextVersion, "1.5.0");
  assert.equal(state.commits.length, 3); assert.equal(state.clean, true);
  assert.deepEqual(state.remotes, []);
  assert.equal(repo.prepareDraft({ ...argsFor(state), version: "1.4.1" }).error, "wrong_version");
  assert.equal(repo.prepareDraft({ ...argsFor(state), commitIds: state.commits.slice(0, 2).map((item) => item.id) }).error, "missing_or_extra_commits");
  assert.equal(repo.prepareDraft({ ...argsFor(state), expectedHead: "0".repeat(40) }).error, "head_changed");
  assert.equal(repo.inspect().clean, true);
});

test("draft writes all commits locally without tag, remote or publication", () => {
  const { repoPath, repo } = setup(); const state = repo.inspect();
  const sourceBytes = fs.readFileSync(path.join(repoPath, "package.json"), "utf8");
  const draft = repo.prepareDraft(argsFor(state));
  assert.equal(draft.metadata.publicationStatus, "draft");
  for (const commit of state.commits) assert.match(draft.notes, new RegExp(commit.id.slice(0, 7)));
  const verified = repo.readDraft();
  assert.deepEqual(verified.tags, ["v1.4.0"]);
  assert.match(verified.gitStatus, /CHANGELOG\.draft\.md/);
  assert.match(verified.gitStatus, /release-draft\.json/);
  assert.deepEqual(repo.inspect().remotes, []);
  assert.equal(repo.git(["rev-parse", "HEAD"]), state.head);
  assert.equal(fs.readFileSync(path.join(repoPath, "package.json"), "utf8"), sourceBytes);
});

test("dirty tree and unseeded repository refuse preparation", () => {
  const { repoPath, repo } = setup(); const state = repo.inspect();
  fs.writeFileSync(path.join(repoPath, "unreviewed.txt"), "surprise\n");
  assert.equal(repo.prepareDraft(argsFor(state)).error, "dirty_repository");
  assert.equal(fs.existsSync(path.join(repoPath, "release-draft.json")), false);
  assert.throws(() => new ReleaseRepo(path.dirname(repoPath)), /seeded synthetic/);
});

test("stdio MCP exposes inspection and authorized draft only", async () => {
  const { repoPath, repo } = setup();
  const readonly = await connect(repoPath, false);
  let state;
  try {
    assert.deepEqual((await readonly.client.listTools()).tools.map((item) => item.name).sort(), ["inspect_release", "prepare_release_draft", "read_release_draft"]);
    state = body(await readonly.call("inspect_release"));
    const blocked = await readonly.call("prepare_release_draft", argsFor(state));
    assert.equal(blocked.isError, true); assert.equal(body(blocked).error, "writes_not_authorized");
  } finally { await readonly.client.close(); }
  assert.equal(repo.inspect().clean, true);
  const writable = await connect(repoPath, true);
  try {
    const prepared = await writable.call("prepare_release_draft", argsFor(state));
    assert.equal(prepared.isError, false);
    const verified = body(await writable.call("read_release_draft"));
    assert.equal(verified.metadata.version, "1.5.0");
    assert.deepEqual(verified.tags, ["v1.4.0"]);
  } finally { await writable.client.close(); }
});
