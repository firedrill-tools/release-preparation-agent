/** Model-free caller preflight; does not grant the runtime a durable read. */
import { parseArgs } from "node:util";
import { GitRunner } from "../src/git-runner.js";
import { ManagedRelease } from "../src/control.js";
import { intentFor } from "../src/snapshot.js";
const { values } = parseArgs({
  options: { repo: { type: "string" }, "intent-only": { type: "boolean" } },
});
if (!values.repo) throw Error("--repo required");
const controller = new AbortController(),
  handlers = new Map(),
  owner = {
    signal: controller.signal,
    deadline: performance.now() + 20000,
    receipt: { data: { git: [] }, save() {} },
    basicGuard() {
      this.signal.throwIfAborted();
      if (performance.now() >= this.deadline)
        throw Error("caller preflight deadline exceeded");
    },
  },
  runner = new GitRunner(values.repo, owner);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () =>
    controller.abort(Error(signal + " cancelled caller preflight"));
  handlers.set(signal, handler);
  process.once(signal, handler);
}
try {
  const store = new ManagedRelease(runner.root, runner, owner),
    source = await store.capture();
  console.log(
    JSON.stringify(
      values["intent-only"]
        ? intentFor(source.snapshot.business)
        : {
            business: source.snapshot.business,
            sourceClean: source.sourceClean,
            intent: intentFor(source.snapshot.business),
          },
      null,
      2,
    ),
  );
} finally {
  await runner.close();
  for (const [signal, handler] of handlers)
    process.removeListener(signal, handler);
}
