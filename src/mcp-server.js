/** Explicit manual synthetic-human stdio seam over the same managed source. */
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { GitRunner } from "./git-runner.js";
import { ManagedRelease, businessResult } from "./control.js";
import { draftArgs } from "./snapshot.js";
import { validateRoot } from "./frame.js";
const { values } = parseArgs({
  options: { repo: { type: "string" }, "allow-writes": { type: "boolean" } },
});
if (!values.repo) throw Error("--repo required");
const controller = new AbortController(),
  owner = {
    signal: controller.signal,
    deadline: performance.now() + 120000,
    receipt: { data: { git: [] }, save() {} },
    basicGuard() {
      this.signal.throwIfAborted();
      if (performance.now() >= this.deadline)
        throw Error("manual tool server deadline exceeded");
    },
  },
  root = validateRoot(values.repo),
  runner = new GitRunner(root, owner),
  store = new ManagedRelease(root, runner, owner),
  server = new McpServer({
    name: "synthetic-release-preparation",
    version: "0.2.0",
  });
const result = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError: Boolean(value?.error),
});
function safe(name, handler) {
  return async (args) => {
    try {
      return result(businessResult(name, await handler(args)));
    } catch (e) {
      return result({ error: e.message });
    }
  };
}
server.registerTool(
  "inspect_release",
  {
    description:
      "Read complete current Git/source/version/clean state. A genuine inspection is required in this tool session before preparing a draft.",
    inputSchema: z.strictObject({}),
  },
  safe("inspect_release", () => store.inspect()),
);
server.registerTool(
  "prepare_release_draft",
  {
    description:
      "Prepare fixed local notes/metadata after exact source/intent/permission and complete range checks. Publication is unavailable.",
    inputSchema: draftArgs,
  },
  safe("prepare_release_draft", (args) =>
    values["allow-writes"]
      ? store.prepare(args)
      : { error: "writes_not_authorized" },
  ),
);
server.registerTool(
  "read_release_draft",
  {
    description:
      "Verify current local draft files against original recorded source/decision. Never tags pushes or publishes.",
    inputSchema: z.strictObject({}),
  },
  safe("read_release_draft", () => store.readDraft()),
);
const service = serveStdio(() => server, {
  onerror: (e) => console.error(e.message),
});
let closing;
function close(reason) {
  closing ??= (async () => {
    controller.abort(Error(reason));
    await runner.close();
    await service.close();
  })();
  void closing.catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
process.stdin.once("end", () => close("manual stdio input closed"));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.once(signal, () => close(signal + " cancelled manual tool server"));
