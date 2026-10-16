/** Explicit stable-version Conventional Commits subset and safe arithmetic. */
export const VERSION_POLICY = Object.freeze({
  id: "stable-conventional-v1",
  supported_versions:
    "stable nonnegative canonical MAJOR.MINOR.PATCH, each safe integer",
  feature_type: "feat, case insensitive, optional scope",
  breaking:
    "exclamation after any type/scope or uppercase BREAKING CHANGE/BREAKING-CHANGE footer",
  default_bump: "patch",
  revert_policy:
    "no inferred revert cancellation; each declared message is evaluated",
});
export function stableVersion(value) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,15})\.(?:0|[1-9][0-9]{0,15})\.(?:0|[1-9][0-9]{0,15})$/.test(
      value,
    )
  )
    throw Error("canonical stable version required");
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw Error("safe version components required");
  return parts;
}
export function deriveVersion(current, commits) {
  const parts = stableVersion(current);
  if (!Array.isArray(commits) || !commits.length)
    throw Error("complete unreleased commit range required");
  const decisions = commits.map((commit) => {
    const message = commit.message;
    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 64000 ||
      !message.isWellFormed() ||
      message.includes("\0")
    )
      throw Error("bounded full commit message required");
    const normalized = message.replaceAll("\r\n", "\n"),
      lines = normalized.split("\n"),
      header =
        /^([a-z][a-z0-9_-]*)(?:\(([^()\r\n]{1,120})\))?(!)?: (.+)$/i.exec(
          lines[0],
        );
    const footer = lines.some(
        (line, n) =>
          n > 1 &&
          lines.slice(1, n).some((previous) => previous === "") &&
          /^BREAKING(?: CHANGE|-CHANGE): \S/.test(line),
      ),
      breaking = !!header?.[3] || footer;
    return {
      id: commit.id,
      type: header?.[1].toLowerCase() ?? null,
      scope: header?.[2] ?? null,
      breaking,
      reason: breaking
        ? "declared breaking header/footer"
        : header?.[1].toLowerCase() === "feat"
          ? "declared feature"
          : "explicit default patch policy",
    };
  });
  const bump = decisions.some((c) => c.breaking)
      ? "major"
      : decisions.some((c) => c.type === "feat")
        ? "minor"
        : "patch",
    position = { major: 0, minor: 1, patch: 2 }[bump];
  if (parts[position] === Number.MAX_SAFE_INTEGER)
    throw Error("version_exhausted");
  parts[position]++;
  for (let n = position + 1; n < 3; n++) parts[n] = 0;
  return {
    bump,
    nextVersion: parts.join("."),
    policy: VERSION_POLICY,
    versionDecisions: decisions,
  };
}
