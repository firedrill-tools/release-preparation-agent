import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { Agent, fetch as httpFetch } from "undici";
import { parseJSON } from "./json.js";
import { hash } from "./source.js";
import { errorInfo, usageOf } from "./evidence.js";
import {
  decodeStream,
  qualifyStream,
  reportedStreamUsage,
} from "./native-stream.js";
export const MAX_REQUESTS = 16;
export function configuration(options) {
  const model = options.model ?? process.env.CLAUDE_MODEL,
    key = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (
    typeof model !== "string" ||
    !/^claude-[A-Za-z0-9._-]{1,120}$/.test(model)
  )
    throw Error("an explicit enabled CLAUDE_MODEL is required");
  if (
    typeof key !== "string" ||
    !key.trim() ||
    key.length > 1024 ||
    !/[\x21-\x7e]+/.test(key) ||
    /[\x00-\x20\x7f-\uffff]/.test(key)
  )
    throw Error("ANTHROPIC_API_KEY is required");
  const endpoint = new URL(
    options.baseUrl ??
      process.env.ANTHROPIC_BASE_URL ??
      "https://api.anthropic.com",
  );
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(endpoint.hostname)
      ))
  )
    throw Error("provider needs an exact HTTPS or owned HTTP loopback origin");
  return { model, key, origin: endpoint.origin };
}
export class Native {
  constructor(config, receipt, owner) {
    Object.assign(this, { config, receipt, owner });
    this.pool = new Agent({
      connections: 1,
      pipelining: 1,
      connect: { timeout: 5000, rejectUnauthorized: true },
      headersTimeout: 30000,
      bodyTimeout: 30000,
    });
    this.proxyKey = randomBytes(32).toString("hex");
    this.pending = new Set();
    this.active = false;
    this.closeAttempted = false;
    this.closed = false;
    this.server = null;
  }
  async open() {
    this.owner.basicGuard();
    this.server = createServer((req, res) => {
      const work = this.handle(req, res);
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
    });
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }
  async handle(req, res) {
    let call, phaseTimer;
    try {
      this.owner.basicGuard();
      const url = new URL(req.url, "http://local");
      if (
        req.method !== "POST" ||
        url.pathname !== "/v1/messages" ||
        [...url.searchParams.keys()].some((k) => k !== "beta") ||
        url.searchParams.getAll("beta").length > 1 ||
        (url.searchParams.has("beta") &&
          url.searchParams.get("beta") !== "true") ||
        req.headers["x-api-key"] !== this.proxyKey ||
        this.closeAttempted
      )
        throw Error("unqualified local native proxy request");
      if (this.active)
        throw Error("parallel native proxy requests are unsupported");
      this.active = true;
      if (this.receipt.data.calls.length >= MAX_REQUESTS)
        throw Error("native prepared request budget exhausted");
      if (this.owner.authority && !this.owner.authority.consumed)
        throw Error("original native tool authority was not consumed");
      call = {
        number: this.receipt.data.calls.length + 1,
        status: "prepared",
        endpoint: url.pathname + url.search,
        reportedUsage: usageOf(null),
      };
      this.receipt.data.calls.push(call);
      this.receipt.save();
      const chunks = [];
      let size = 0;
      for await (const b of req) {
        size += b.length;
        if (size > 2 * 1024 * 1024)
          throw Error("native request exceeds retained limit");
        chunks.push(b);
      }
      const raw = Buffer.concat(chunks),
        body = parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      Object.assign(call, {
        request: {
          bodyBase64: raw.toString("base64"),
          sha256: hash(raw),
          decodedBytes: raw.length,
          body,
        },
      });
      this.receipt.save();
      if (
        body.model !== this.config.model ||
        body.stream !== true ||
        body.max_tokens !== 4096 ||
        body.thinking?.type !== "disabled"
      )
        throw Error(
          "native model/stream/output/thinking request differs from configured bounds",
        );
      await this.owner.guard();
      const phaseMs = Math.max(
          1,
          Math.min(30000, Math.ceil(this.owner.deadline - performance.now())),
        ),
        phase = new AbortController();
      phaseTimer = setTimeout(
        () =>
          phase.abort(
            Error(
              phaseMs < 30000
                ? "release operation deadline exceeded during native HTTP"
                : "native HTTP deadline exceeded",
            ),
          ),
        phaseMs,
      );
      const signal = AbortSignal.any([this.owner.signal, phase.signal]);
      const response = await httpFetch(
        this.config.origin + url.pathname + url.search,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            ...(typeof req.headers["anthropic-beta"] === "string"
              ? { "anthropic-beta": req.headers["anthropic-beta"] }
              : {}),
            "x-api-key": this.config.key,
          },
          body: raw,
          dispatcher: this.pool,
          redirect: "manual",
          signal,
        },
      );
      call.response = {
        status: response.status,
        headers: Object.fromEntries(
          ["content-type", "request-id", "x-request-id", "anthropic-request-id"]
            .filter((k) => response.headers.has(k))
            .map((k) => [k, response.headers.get(k)]),
        ),
        complete: false,
      };
      const reader = response.body?.getReader(),
        parts = [];
      let bytes = 0;
      try {
        if (reader)
          for (;;) {
            const n = await reader.read();
            if (n.done) break;
            const left = 1024 * 1024 - bytes,
              part = n.value.subarray(0, Math.max(0, left));
            parts.push(part);
            bytes += part.length;
            if (n.value.length > left) {
              await reader.cancel();
              throw Error("native decoded response exceeds retained limit");
            }
          }
        call.response.complete = true;
      } finally {
        reader?.releaseLock();
        const retained = Buffer.concat(parts);
        Object.assign(call.response, {
          bodyBase64: retained.toString("base64"),
          decodedBytes: retained.length,
          sha256: call.response.complete ? hash(retained) : null,
          prefixSha256: hash(retained),
        });
        this.receipt.save();
      }
      const data = Buffer.from(call.response.bodyBase64, "base64");
      if (!response.ok) {
        try {
          call.response.body = parseJSON(
            new TextDecoder("utf-8", { fatal: true }).decode(data),
          );
          call.reportedUsage = usageOf(call.response.body);
        } catch {}
        throw Error(`native provider HTTP ${response.status}`);
      }
      if (
        !(response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes("text/event-stream")
      )
        throw Error("native provider did not return original SSE");
      const events = decodeStream(data);
      call.response.events = events;
      call.reportedUsage = reportedStreamUsage(events);
      this.receipt.save();
      const parsed = qualifyStream(events);
      if (parsed.model !== this.config.model)
        throw Error("original native model differs from configured model");
      Object.assign(call, {
        status: "accepted",
        original: parsed,
        accepted: parsed.accepted,
      });
      if (
        parsed.accepted.kind === "tool" &&
        (call.number === MAX_REQUESTS ||
          this.receipt.data.calls.some(
            (c) =>
              c !== call &&
              c.accepted?.kind === "tool" &&
              c.accepted.id === parsed.accepted.id,
          ))
      )
        throw Error(
          "original native action is replayed or exceeds final request tool budget",
        );
      await this.owner.guard();
      this.owner.authority =
        parsed.accepted.kind === "tool"
          ? {
              number: call.number,
              accepted: parsed.accepted,
              consumed: false,
              permission: false,
            }
          : null;
      this.owner.originalAnswer =
        parsed.accepted.kind === "answer" ? parsed.accepted.text : null;
      this.receipt.save();
      this.owner.basicGuard();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(data);
    } catch (e) {
      if (call) {
        call.status = "failed";
        call.error = errorInfo(e);
        try {
          this.receipt.save();
        } catch {}
      }
      this.owner.fail(e);
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "The owned native boundary rejected this operation.",
            },
          }),
        );
      }
    } finally {
      clearTimeout(phaseTimer);
      this.active = false;
    }
  }
  async close() {
    if (this.closeAttempted)
      throw Error("native proxy close already attempted");
    this.closeAttempted = true;
    const errors = [];
    if (this.server) {
      this.server.closeAllConnections();
      try {
        await new Promise((resolve, reject) =>
          this.server.close((e) => (e ? reject(e) : resolve())),
        );
      } catch (e) {
        errors.push(e);
      }
    }
    try {
      await this.pool.destroy();
    } catch (e) {
      errors.push(e);
    }
    await Promise.allSettled([...this.pending]);
    if (errors.length) throw errors[0];
    this.closed = true;
  }
}
