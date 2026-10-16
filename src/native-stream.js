/** Complete original Anthropic SSE is checked before any eager CLI delivery. */
import { z } from "zod";
import { parseJSON } from "./json.js";
import { same } from "./frame.js";
import { draftArgs } from "./snapshot.js";
import { usageOf } from "./evidence.js";
export const argumentsFor = {
  mcp__release__inspect_release: z.strictObject({}),
  mcp__release__prepare_release_draft: draftArgs,
  mcp__release__read_release_draft: z.strictObject({}),
};
export function decodeStream(raw) {
  const wire = new TextDecoder("utf-8", { fatal: true })
    .decode(raw)
    .replaceAll("\r\n", "\n");
  if (!wire.endsWith("\n\n") || wire.includes("\r"))
    throw Error("incomplete or ambiguous native SSE framing");
  const events = [];
  for (const frame of wire.split("\n\n")) {
    if (!frame) continue;
    let event = null;
    const lines = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        if (event !== null) throw Error("duplicate SSE event type");
        event = line.slice(6).replace(/^ /, "");
      } else if (line.startsWith("data:"))
        lines.push(line.slice(5).replace(/^ /, ""));
      else throw Error("unsupported native SSE field");
    }
    if (!lines.length) {
      if (event) throw Error("native SSE event lacks original data");
      continue;
    }
    const value = parseJSON(lines.join("\n"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.type !== "string" ||
      (event !== null && event !== value.type)
    )
      throw Error("native SSE event identity differs");
    events.push(value);
  }
  return events;
}
export function reportedStreamUsage(events) {
  const starts = events.filter((e) => e.type === "message_start"),
    deltas = events.filter((e) => e.type === "message_delta");
  return usageOf(
    starts.length === 1 && deltas.length === 1
      ? { usage: { ...starts[0].message?.usage, ...deltas[0].usage } }
      : null,
  );
}
export function completedStream(raw) {
  return qualifyStream(decodeStream(raw));
}
export function qualifyStream(events) {
  let start = null,
    delta = null,
    ended = false,
    open = null,
    next = 0;
  const blocks = [];
  for (const e of events) {
    if (ended) throw Error("native event follows message_stop");
    if (e.type === "ping") {
      if (e.type !== "ping") throw Error("invalid ping");
      continue;
    }
    if (e.type === "message_start") {
      if (start || open || blocks.length || delta)
        throw Error("duplicate or misplaced native message_start");
      const m = e.message;
      if (
        !m ||
        m.type !== "message" ||
        m.role !== "assistant" ||
        typeof m.id !== "string" ||
        !m.id.trim() ||
        m.id.length > 240 ||
        typeof m.model !== "string" ||
        !m.model.trim() ||
        !Array.isArray(m.content) ||
        m.content.length ||
        m.stop_reason !== null
      )
        throw Error("invalid original native message_start");
      start = m;
      continue;
    }
    if (!start) throw Error("native message_start required");
    if (e.type === "content_block_start") {
      if (open || delta || e.index !== next || !Number.isSafeInteger(e.index))
        throw Error("native block sequence is ambiguous");
      const b = e.content_block;
      if (!b || !["text", "tool_use"].includes(b.type))
        throw Error("unknown/refused native content block");
      if (b.type === "text") {
        if (typeof b.text !== "string")
          throw Error("invalid original text block");
        open = { index: e.index, type: b.type, text: b.text };
      } else {
        if (
          typeof b.id !== "string" ||
          !b.id.trim() ||
          b.id.length > 240 ||
          !argumentsFor[b.name] ||
          !b.input ||
          typeof b.input !== "object" ||
          Array.isArray(b.input)
        )
          throw Error("invalid original native tool identity/input");
        open = {
          index: e.index,
          type: b.type,
          id: b.id,
          name: b.name,
          input: b.input,
          json: "",
        };
      }
      continue;
    }
    if (e.type === "content_block_delta") {
      if (!open || e.index !== open.index || delta)
        throw Error("native block delta lacks its exact open block");
      const d = e.delta;
      if (open.type === "text") {
        if (d?.type !== "text_delta" || typeof d.text !== "string")
          throw Error("unknown native text delta");
        open.text += d.text;
      } else {
        if (
          d?.type !== "input_json_delta" ||
          typeof d.partial_json !== "string"
        )
          throw Error("unknown native tool input delta");
        open.json += d.partial_json;
      }
      continue;
    }
    if (e.type === "content_block_stop") {
      if (!open || e.index !== open.index || delta)
        throw Error("native block stop differs");
      if (open.type === "tool_use") {
        if (open.json && Object.keys(open.input).length)
          throw Error("ambiguous original tool input");
        open.args = argumentsFor[open.name].parse(
          open.json ? parseJSON(open.json) : open.input,
        );
        delete open.json;
        delete open.input;
      }
      blocks.push(open);
      open = null;
      next++;
      continue;
    }
    if (e.type === "message_delta") {
      if (
        delta ||
        open ||
        !blocks.length ||
        !e.delta ||
        typeof e.delta.stop_reason !== "string"
      )
        throw Error("native message_delta is incomplete or duplicated");
      delta = e;
      continue;
    }
    if (e.type === "message_stop") {
      if (!delta || open)
        throw Error("native message_stop precedes completed original content");
      ended = true;
      continue;
    }
    throw Error("unknown/error/refused native SSE event");
  }
  if (!start || !delta || !ended || open)
    throw Error("original native SSE did not complete");
  const tools = blocks.filter((b) => b.type === "tool_use"),
    answer = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(""),
    stop = delta.delta.stop_reason;
  let accepted;
  if (stop === "tool_use" && tools.length === 1)
    accepted = {
      kind: "tool",
      id: tools[0].id,
      name: tools[0].name,
      args: tools[0].args,
    };
  else if (stop === "end_turn" && !tools.length && answer.trim())
    accepted = { kind: "answer", text: answer };
  else
    throw Error(
      "native response is unfinished/refused/parallel or has no completed answer",
    );
  const usage = { ...start.usage, ...delta.usage };
  return {
    events,
    messageId: start.id,
    model: start.model,
    stopReason: stop,
    blocks,
    originalUsage: { start: start.usage ?? null, delta: delta.usage ?? null },
    reportedUsage: usageOf({ usage }),
    accepted,
  };
}
export function matchesAction(authority, name, args, id = null) {
  return (
    !!authority &&
    authority.accepted.kind === "tool" &&
    authority.accepted.name === name &&
    same(authority.accepted.args, args) &&
    (id === null || authority.accepted.id === id)
  );
}
