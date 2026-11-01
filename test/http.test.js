import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { baseEnv } from "./helpers.js";

const env = baseEnv();
const auth = { Authorization: "Bearer test-token-123456", "Content-Type": "application/json" };
const call = (path, opt = {}) => worker.fetch(new Request("https://af.example.workers.dev" + path, opt), env, {});

test("dashboard is public, API needs the token", async () => {
  const ui = await call("/");
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal((await call("/api/aliases")).status, 401);
  assert.equal((await call("/api/aliases", { headers: { Authorization: "Bearer wrong-token-xxxx" } })).status, 401);
  assert.equal((await call("/mcp", { method: "POST", body: "{}" })).status, 401);
});

test("weak ADMIN_TOKEN is refused", async () => {
  const r = await worker.fetch(new Request("https://x/api/config", { headers: { Authorization: "Bearer short" } }), baseEnv({ ADMIN_TOKEN: "short" }), {});
  assert.equal(r.status, 401);
});

test("alias CRUD over REST", async () => {
  let r = await call("/api/aliases", { method: "POST", headers: auth, body: JSON.stringify({ note: "GitHub" }) });
  assert.equal(r.status, 201);
  const { alias } = await r.json();
  assert.match(alias.address, /^github\.[a-z2-9]{4}@example\.com$/);

  r = await call("/api/aliases", { method: "POST", headers: auth, body: JSON.stringify({ local: "Bad Name" }) });
  assert.equal(r.status, 400);
  r = await call("/api/aliases", { method: "POST", headers: auth, body: JSON.stringify({ address: "x@evil.com" }) });
  assert.equal(r.status, 400);

  r = await call(`/api/aliases/${alias.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ enabled: false, note: "gh" }) });
  const upd = (await r.json()).alias;
  assert.equal(upd.enabled, false);
  assert.equal(upd.note, "gh");

  const cfg = await (await call("/api/config", { headers: auth })).json();
  assert.deepEqual(cfg.domains, ["example.com"]);
  assert.equal(cfg.outbound, "none");
  assert.equal(cfg.stats.aliases, 1);

  r = await call(`/api/aliases/${alias.id}`, { method: "DELETE", headers: auth });
  assert.equal(r.status, 200);
  r = await call(`/api/aliases/${alias.id}`, { method: "DELETE", headers: auth });
  assert.equal(r.status, 404);
});

test("send without a transport gives a clear error", async () => {
  await call("/api/aliases", { method: "POST", headers: auth, body: JSON.stringify({ local: "me" }) });
  const r = await call("/api/send", { method: "POST", headers: auth, body: JSON.stringify({ alias: "me@example.com", to: "a@b.com", subject: "hi", text: "yo" }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /RESEND_API_KEY/);
});

test("send via Resend uses the alias as From", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    calls.push({ url, body: JSON.parse(opt.body), auth: opt.headers.Authorization });
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  };
  try {
    const e2 = baseEnv({ RESEND_API_KEY: "re_test" });
    const h = { ...auth };
    await worker.fetch(new Request("https://x/api/aliases", { method: "POST", headers: h, body: JSON.stringify({ local: "news" }) }), e2, {});
    const r = await worker.fetch(new Request("https://x/api/send", { method: "POST", headers: h, body: JSON.stringify({ alias: "news@example.com", to: "Bob@Corp.com", subject: "Hi", text: "Hello" }) }), e2, {});
    assert.equal(r.status, 200);
    assert.equal((await r.json()).via, "resend");
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].body.from, "news@example.com");
    assert.deepEqual(calls[0].body.to, ["bob@corp.com"]);
    assert.equal(calls[0].auth, "Bearer re_test");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("MCP: initialize, list tools, create alias, read code", async () => {
  const rpc = async (method, params, id = 1) => (await (await call("/mcp", { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) })).json());
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.result.serverInfo.name, "aliasflare");
  const tools = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
  assert.deepEqual(tools, ["create_alias", "list_aliases", "set_alias_enabled", "get_latest_code", "recent_messages", "send_from_alias"]);
  const created = JSON.parse((await rpc("tools/call", { name: "create_alias", arguments: { note: "notion" } })).result.content[0].text);
  assert.match(created.address, /^notion\./);
  const code = JSON.parse((await rpc("tools/call", { name: "get_latest_code", arguments: { alias: created.address } })).result.content[0].text);
  assert.equal(code.code, null);
  const off = JSON.parse((await rpc("tools/call", { name: "set_alias_enabled", arguments: { alias: created.address, enabled: false } })).result.content[0].text);
  assert.equal(off.enabled, false);
  const bad = await rpc("tools/call", { name: "nope", arguments: {} });
  assert.equal(bad.error.code, -32602);
  const notif = await call("/mcp", { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(notif.status, 202);
});
