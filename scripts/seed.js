import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function seed(directory) {
  const root = path.resolve(directory);
  if (fs.existsSync(root)) throw new Error(`destination already exists: ${root}`);
  fs.mkdirSync(root, { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-10-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T12:00:00Z" } }).trim();
  const put = (name, content) => fs.writeFileSync(path.join(root, name), content);
  git(["init", "-b", "main"]); git(["config", "user.name", "Firedrill Fixture"]); git(["config", "user.email", "fixture@firedrill.example"]);
  put(".firedrill-release-sample", "synthetic release sample\n");
  put("package.json", `${JSON.stringify({ name: "meridian-reporting", version: "1.4.0", private: true }, null, 2)}\n`);
  put("README.md", "# Meridian reporting\n\nSynthetic release fixture.\n");
  git(["add", "."]); git(["commit", "-m", "chore: release 1.4.0"]); git(["tag", "v1.4.0"]);
  put("export.js", "export function toCsv(rows) { return rows.map(row => row.join(',')).join('\\n'); }\n");
  git(["add", "."]); git(["commit", "-m", "feat: add CSV export"]);
  put("tax.js", "export function cents(amount) { return Math.round(amount * 100); }\n");
  git(["add", "."]); git(["commit", "-m", "fix: correct tax rounding"]);
  put("AUDIT.md", "# Audit log\n\nExports and rounding changes are recorded in the application audit log.\n");
  git(["add", "."]); git(["commit", "-m", "docs: describe audit log"]);
  return root;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--dir");
  try { console.log(seed(i < 0 ? "workspace" : process.argv[i + 1])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
