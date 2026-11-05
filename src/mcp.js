// MCP server (JSON-RPC 2.0 over Streamable HTTP, JSON responses) so AI agents
// can make aliases and read verification codes themselves.

import { createAlias, setEnabled, sendFromAlias, publicAlias, findAlias } from "./service.js";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "aliasflare", title: "aliasflare email aliases", version: "0.2.0" };

export const TOOLS = [
  {
    name: "create_alias",
    title: "Create email alias",
    description:
      "Create a new forwarding email alias on the user's own domain, e.g. for signing up to a website without revealing the real address. " +
      "Mail sent to the alias is forwarded to the user's inbox. Returns the new address. " +
      "Pass `note` (the site or purpose, e.g. \"github\") to get a readable address like github.k3f9@domain; omit it for a random one.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "What the alias is for, e.g. the website name. Used as the address prefix and shown in the dashboard." },
        local: { type: "string", description: "Exact part before @ (a-z, 0-9, . _ -). Optional; random if omitted." },
        domain: { type: "string", description: "Which configured domain to use. Optional; defaults to the first one." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "list_aliases",
    title: "List aliases",
    description: "List the user's aliases, newest first, with note, enabled state and forwarded/blocked counts. Optional `query` filters by address or note.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring of the address or note." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "set_alias_enabled",
    title: "Enable or disable alias",
    description: "Turn an alias off (mail to it is rejected as if it never existed — use this to stop spam) or back on.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Alias address or numeric id." },
        enabled: { type: "boolean" },
      },
      required: ["alias", "enabled"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_latest_code",
    title: "Get latest verification code",
    description:
      "Return the most recent one-time verification code (OTP) received by an alias within the last `since_minutes` minutes, " +
      "extracted from the email subject/body. Use right after triggering a sign-up or login email. Returns null code if none arrived yet; wait and call again.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Alias address. Omit to search all aliases." },
        since_minutes: { type: "integer", minimum: 1, maximum: 1440, default: 15 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "recent_messages",
    title: "Recent mail log",
    description: "Show recent mail activity (sender, subject, code, direction) — metadata only, no bodies. Optional `alias` filter.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Alias address or id." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "send_from_alias",
    title: "Send email from alias",
    description:
      "Send a plain-text email to someone FROM one of the user's aliases, so the real address stays hidden. Requires RESEND_API_KEY, BREVO_API_KEY or Cloudflare Email Sending. " +
      "This sends real mail: only call it when the user asked to send this exact message.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Alias address to send from." },
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string" },
        text: { type: "string", description: "Plain-text body." },
      },
      required: ["alias", "to", "subject", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

const err = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const text = (obj, isError = false) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }], isError });

async function callTool(name, args, store, env, fetchImpl) {
  switch (name) {
    case "create_alias":
      return createAlias(store, env, { note: args.note, local: args.local, domain: args.domain });
    case "list_aliases":
      return (await store.listAliases({ q: args.query || "", limit: args.limit || 50 })).map(publicAlias);
    case "set_alias_enabled":
      return setEnabled(store, args.alias, args.enabled);
    case "get_latest_code": {
      const r = await store.latestCode({ address: args.alias, sinceMinutes: args.since_minutes || 15 });
      return r ? { code: r.code, alias: r.alias, from: r.peer, subject: r.subject, received_at: r.created_at + "Z" } : { code: null, note: "No code received yet in this window." };
    }
    case "recent_messages": {
      const alias_id = args.alias ? (await findAlias(store, args.alias)).id : undefined;
      return (await store.listMessages({ alias_id, limit: args.limit || 20 })).map((m) => ({
        at: m.created_at + "Z", alias: m.alias, direction: m.direction, peer: m.peer, subject: m.subject, code: m.code,
      }));
    }
    case "send_from_alias":
      return sendFromAlias(store, env, { alias: args.alias, to: args.to, subject: args.subject, text: args.text }, fetchImpl);
    default:
      return undefined;
  }
}

export async function handleRpc(msg, store, env, fetchImpl = fetch) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg?.id, -32600, "Invalid Request");
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined;
  switch (method) {
    case "initialize": {
      const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok(id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "aliasflare manages the user's private email aliases. Typical flow for a sign-up: create_alias(note=<site>) → use the address → get_latest_code(alias=<address>).",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) return err(id, -32602, `Unknown tool: ${params.name}`);
      try {
        return ok(id, text(await callTool(params.name, params.arguments || {}, store, env, fetchImpl)));
      } catch (e) {
        return ok(id, text(`Error: ${e.message}`, true));
      }
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return isNotification ? null : err(id, -32601, `Method not found: ${method}`);
  }
}
