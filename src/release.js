import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export class ReleaseRepo {
  constructor(root) {
    this.root = path.resolve(root);
    if (!fs.existsSync(path.join(this.root, ".firedrill-release-sample"))) throw new Error("only a seeded synthetic release repository is supported");
    this.git(["rev-parse", "--show-toplevel"]);
  }
  git(args) { return execFileSync("git", ["--no-pager", ...args], { cwd: this.root, encoding: "utf8", stdio: "pipe" }).trim(); }
  inspect() {
    const manifest = JSON.parse(fs.readFileSync(path.join(this.root, "package.json"), "utf8"));
    const baseTag = `v${manifest.version}`;
    this.git(["rev-parse", "--verify", `refs/tags/${baseTag}`]);
    const head = this.git(["rev-parse", "HEAD"]);
    const status = this.git(["status", "--porcelain"]);
    const raw = this.git(["log", "--format=%H%x09%s", `${baseTag}..HEAD`]);
    const commits = raw ? raw.split("\n").map((line) => { const [id, subject] = line.split("\t"); return { id, subject }; }) : [];
    const [major, minor, patch] = manifest.version.split(".").map(Number);
    if (![major, minor, patch].every(Number.isSafeInteger) || !commits.length) throw new Error("invalid version or no unreleased commits");
    const bump = commits.some((item) => /^(feat|fix|chore|docs)!:/.test(item.subject)) ? "major"
      : commits.some((item) => item.subject.startsWith("feat:")) ? "minor" : "patch";
    const nextVersion = bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
    return { repository: manifest.name, currentVersion: manifest.version, baseTag, head, clean: !status, dirtyPaths: status.split("\n").filter(Boolean), commits, bump, nextVersion,
      remotes: this.git(["remote"]).split("\n").filter(Boolean) };
  }
  prepareDraft({ version, baseTag, expectedHead, commitIds }) {
    const state = this.inspect();
    if (!state.clean) return { error: "dirty_repository", paths: state.dirtyPaths };
    if (state.head !== expectedHead) return { error: "head_changed" };
    if (state.baseTag !== baseTag) return { error: "wrong_base_tag" };
    if (state.nextVersion !== version) return { error: "wrong_version", expected: state.nextVersion };
    if (!Array.isArray(commitIds) || commitIds.length !== state.commits.length || state.commits.some((item, i) => item.id !== commitIds[i])) return { error: "missing_or_extra_commits", expectedIds: state.commits.map((item) => item.id) };
    const notes = `# ${state.repository} v${version}\n\nDraft release notes. Publication is separate.\n\n## Changes since ${baseTag}\n\n${state.commits.map((item) => `- ${item.subject} (${item.id.slice(0, 7)})`).join("\n")}\n`;
    const metadata = { version, baseTag, head: state.head, commitIds, publicationStatus: "draft", notesFile: "CHANGELOG.draft.md" };
    fs.writeFileSync(path.join(this.root, "CHANGELOG.draft.md"), notes);
    fs.writeFileSync(path.join(this.root, "release-draft.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    return { notes, metadata };
  }
  readDraft() {
    const metadata = JSON.parse(fs.readFileSync(path.join(this.root, "release-draft.json"), "utf8"));
    const notes = fs.readFileSync(path.join(this.root, "CHANGELOG.draft.md"), "utf8");
    return { metadata, notes, gitStatus: this.git(["status", "--porcelain"]), tags: this.git(["tag", "--list"]).split("\n").filter(Boolean) };
  }
}
