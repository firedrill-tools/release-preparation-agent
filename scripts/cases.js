/** Private model-free case CLI. Provider keys are never read. */
import { parseArgs } from "node:util";
import { listCases, initialize, inspect, reset } from "../src/datasets.js";
const controller = new AbortController(),
  handlers = new Map();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () =>
    controller.abort(Error(signal + " cancelled private case operation"));
  handlers.set(signal, handler);
  process.once(signal, handler);
}
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      case: { type: "string" },
      destination: { type: "string" },
    },
  });
  if (positionals.length !== 1)
    throw Error(
      "use cases list | init --repo ROOT --case ID | inspect --repo ROOT | reset --repo ROOT --destination FRESH",
    );
  const [command] = positionals;
  let result;
  if (command === "list") {
    if (Object.keys(values).length) throw Error("list takes no options");
    result = listCases();
  } else if (command === "init") {
    if (!values.repo || !values.case || values.destination)
      throw Error("init requires --repo and --case");
    result = await initialize(values.repo, values.case, {
      signal: controller.signal,
    });
  } else if (command === "inspect") {
    if (!values.repo || values.case || values.destination)
      throw Error("inspect requires only --repo");
    result = await inspect(values.repo, { signal: controller.signal });
  } else if (command === "reset") {
    if (!values.repo || !values.destination || values.case)
      throw Error("reset requires --repo and --destination");
    result = await reset(values.repo, values.destination, {
      signal: controller.signal,
    });
  } else throw Error("unknown private case command");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exitCode = 1;
} finally {
  for (const [signal, handler] of handlers)
    process.removeListener(signal, handler);
}
