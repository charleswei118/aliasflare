// aliasflare — self-hosted email aliases on Cloudflare Workers.
import { Store } from "./db.js";
import { handleEmail } from "./email.js";
import { handleRpc, SERVER_INFO } from "./mcp.js";
import { UI_HTML } from "./ui.js";
import { HttpError, createAlias, publicAlias, findAlias, sendFromAlias } from "./service.js";
import { outboundMode } from "./send.js";
import { parseDomains, safeEqual, isUnset } from "./util.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra } });

function authorized(request, env) {
  if (isUnset(env.ADMIN_TOKEN) || String(env.ADMIN_TOKEN).length < 12) return false; // refuse weak/unset tokens
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return safeEqual(token, env.ADMIN_TOKEN);
}

async function readJson(request) {
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) throw new HttpError(413, "body too large");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

async function handleApi(request, env, url, store) {
  const path = url.pathname;
  const m = path.match(/^\/api\/aliases\/(\d+)$/);

  if (path === "/api/config" && request.method === "GET") {
    return json({
      version: SERVER_INFO.version,
      domains: parseDomains(env),
      destination: !isUnset(env.DESTINATION),
      outbound: outboundMode(env),
      auto_create: !["false", "0", "no", "off"].includes(String(env.AUTO_CREATE ?? "").toLowerCase()),
      stats: await store.stats(),
    });
  }
  if (path === "/api/aliases" && request.method === "GET") {
    const aliases = await store.listAliases({ q: url.searchParams.get("q") || "", limit: url.searchParams.get("limit") || 200 });
    return json({ aliases: aliases.map(publicAlias) });
  }
  if (path === "/api/aliases" && request.method === "POST") {
    const b = await readJson(request);
    return json({ alias: await createAlias(store, env, b) }, 201);
  }
  if (m && request.method === "PATCH") {
    const b = await readJson(request);
    await findAlias(store, m[1]);
    return json({ alias: publicAlias(await store.updateAlias(m[1], { enabled: b.enabled, note: b.note })) });
  }
  if (m && request.method === "DELETE") {
    await findAlias(store, m[1]);
    await store.deleteAlias(m[1]);
    return json({ ok: true });
  }
  if (path === "/api/messages" && request.method === "GET") {
    return json({ messages: await store.listMessages({ alias_id: url.searchParams.get("alias_id"), limit: url.searchParams.get("limit") || 50 }) });
  }
  if (path === "/api/code" && request.method === "GET") {
    const r = await store.latestCode({ address: url.searchParams.get("alias") || undefined, sinceMinutes: url.searchParams.get("since") || 15 });
    return json({ code: r?.code || null, ...(r || {}) });
  }
  if (path === "/api/send" && request.method === "POST") {
    return json(await sendFromAlias(store, env, await readJson(request)));
  }
  throw new HttpError(404, "not found");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return new Response(UI_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          ...SECURITY_HEADERS,
        },
      });
    }
    if (path === "/health") return json({ ok: true, name: SERVER_INFO.name, version: SERVER_INFO.version });

    if (path === "/mcp" || path.startsWith("/api/")) {
      if (!authorized(request, env)) {
        return json({ error: isUnset(env.ADMIN_TOKEN) ? "ADMIN_TOKEN is not set" : "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
      }
      const store = await new Store(env.DB).init();
      try {
        if (path === "/mcp") {
          if (request.method === "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
          if (request.method === "DELETE") return new Response(null, { status: 204 });
          if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
          let body;
          try {
            body = await request.json();
          } catch {
            return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
          }
          if (Array.isArray(body)) {
            const out = (await Promise.all(body.map((b) => handleRpc(b, store, env)))).filter(Boolean);
            return out.length ? json(out) : new Response(null, { status: 202 });
          }
          const r = await handleRpc(body, store, env);
          return r ? json(r) : new Response(null, { status: 202 });
        }
        return await handleApi(request, env, url, store);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: "internal error" }, 500);
      }
    }
    return json({ error: "not found" }, 404);
  },

  async email(message, env, ctx) {
    try {
      await handleEmail(message, env, ctx);
    } catch (e) {
      console.error("email handler failed", e);
      // Never lose mail because of our own bug.
      if (!isUnset(env.DESTINATION)) {
        try {
          await message.forward(String(env.DESTINATION).trim());
          return;
        } catch (e2) {
          console.error("fallback forward failed", e2);
        }
      }
      message.setReject("Temporary failure");
    }
  },
};
