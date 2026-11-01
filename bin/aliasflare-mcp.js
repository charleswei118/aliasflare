#!/usr/bin/env node
// Local stdio MCP server for aliasflare.
// initialize / tools/list are answered locally (no config needed), so any MCP
// client or registry can introspect it. Tool calls are forwarded to your own
// deployed aliasflare Worker:
//   ALIASFLARE_URL    e.g. https://aliasflare.example.workers.dev
//   ALIASFLARE_TOKEN  your ADMIN_TOKEN
import { createInterface } from "node:readline";
import { TOOLS, SERVER_INFO, PROTOCOL_VERSIONS } from "../src/mcp.js";

const URL_ = (process.env.ALIASFLARE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.ALIASFLARE_TOKEN || "";

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const toolError = (id, message) => ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });

async function forward(msg) {
  if (!URL_ || !TOKEN) return toolError(msg.id, "set ALIASFLARE_URL and ALIASFLARE_TOKEN to your aliasflare Worker URL and ADMIN_TOKEN.");
  try {
    const r = await fetch(`${URL_}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(msg),
    });
    if (!r.ok) return toolError(msg.id, `aliasflare returned HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    return toolError(msg.id, e.message);
  }
}

export async function handle(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg?.id, -32600, "Invalid Request");
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok(id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "aliasflare manages the user's private email aliases. Typical flow for a sign-up: create_alias(note=<site>) → use the address → get_latest_code(alias=<address>).",
      });
    }
    case "ping": return ok(id, {});
    case "tools/list": return ok(id, { tools: TOOLS });
    case "resources/list": return ok(id, { resources: [] });
    case "prompts/list": return ok(id, { prompts: [] });
    case "tools/call":
      if (!TOOLS.some((t) => t.name === params.name)) return err(id, -32602, `Unknown tool: ${params.name}`);
      return forward(msg);
    default:
      return id === undefined ? null : err(id, -32601, `Method not found: ${method}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("aliasflare-mcp.js")) {
  createInterface({ input: process.stdin }).on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send(err(null, -32700, "Parse error")); }
    const out = await handle(msg);
    if (out) send(out);
  });
}
