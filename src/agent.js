import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseJSON } from "./json.js";
import { runOwnedAgent } from "./runtime.js";
export const runAgent = runOwnedAgent;
export async function main(args = process.argv.slice(2)) {
  const controller = new AbortController(),
    handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () =>
      controller.abort(Error(signal + " cancelled release operation"));
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    const { values } = parseArgs({
      args,
      options: {
        repo: { type: "string" },
        task: { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        "allow-writes": { type: "boolean" },
        "intent-json": { type: "string" },
        output: { type: "string" },
        "timeout-ms": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help || !args.length) {
      console.log(
        "release-preparation --repo ROOT --task TEXT [--model MODEL] [--allow-writes --intent-json JSON] [--base-url PROVIDER_ORIGIN] [--output DIRECTORY] [--timeout-ms MILLISECONDS]",
      );
      return;
    }
    if (values["intent-json"]?.length > 160000)
      throw Error("intent JSON exceeds caller configuration limit");
    const intent =
      values["intent-json"] === undefined
        ? undefined
        : parseJSON(values["intent-json"]);
    const result = await runAgent({
      repository: values.repo,
      task: values.task,
      model: values.model,
      baseUrl: values["base-url"],
      allowWrites: values["allow-writes"] ?? false,
      intent,
      outputRoot: values.output,
      timeoutMs:
        values["timeout-ms"] === undefined
          ? undefined
          : Number(values["timeout-ms"]),
      signal: controller.signal,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: e.message,
          outputDir: e.outputDir ?? null,
          business: e.result?.observedBusiness ?? null,
          usage: e.result?.reportedUsage ?? null,
          cleanupConfirmed: e.result?.cleanupConfirmed ?? null,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
  }
}
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
