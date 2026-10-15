import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { ReleaseRepo } from "./release.js";

const option = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const repository = option("--repo"); if (!repository) throw new Error("--repo required");
const repo = new ReleaseRepo(path.resolve(repository));
const allowWrites = process.argv.includes("--allow-writes");
const result = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], isError: Boolean(value?.error) });
const safe = (handler) => async (args) => { try { return result(await handler(args)); } catch (error) { return result({ error: error instanceof Error ? error.message : String(error) }); } };
const server = new McpServer({ name: "synthetic-release-preparation", version: "0.1.0" });
server.registerTool("inspect_release", { description: "Read Git HEAD, base tag, all unreleased commits, version policy and working tree status in the seeded sample.", inputSchema: z.object({}) }, safe(() => repo.inspect()));
server.registerTool("prepare_release_draft", { description: "Write local release notes and metadata only after checking the exact version, HEAD and complete commit range. Never tags, pushes or publishes.", inputSchema: z.object({ version: z.string(), baseTag: z.string(), expectedHead: z.string(), commitIds: z.array(z.string()) }) }, safe((args) => allowWrites ? repo.prepareDraft(args) : { error: "writes_not_authorized" }));
server.registerTool("read_release_draft", { description: "Read local draft notes, metadata and Git state for verification; no publication operation exists.", inputSchema: z.object({}) }, safe(() => repo.readDraft()));
void serveStdio(() => server, { onerror: (error) => console.error(error.message) });
