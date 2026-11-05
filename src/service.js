// Operations shared by the REST API and the MCP server.

import { sendExternal, outboundMode } from "./send.js";
import { makeLocal, isValidLocal, parseDomains, splitAddress } from "./util.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function publicAlias(a) {
  if (!a) return null;
  return {
    id: a.id, address: a.address, note: a.note, enabled: !!a.enabled, auto: !!a.auto,
    forwarded: a.forwarded, blocked: a.blocked, replied: a.replied, last_at: a.last_at, created_at: a.created_at,
  };
}

export async function createAlias(store, env, { address, local, domain, note = "" } = {}) {
  const domains = parseDomains(env);
  if (!domains.length) throw new HttpError(400, "DOMAIN is not configured");
  let loc, dom;
  if (address) {
    const p = splitAddress(address);
    if (!p) throw new HttpError(400, "invalid address");
    loc = p.local;
    dom = p.domain;
  } else {
    dom = (domain || domains[0]).toLowerCase();
    loc = local ? String(local).toLowerCase() : makeLocal(note);
  }
  if (!domains.includes(dom)) throw new HttpError(400, `domain must be one of: ${domains.join(", ")}`);
  if (!isValidLocal(loc)) throw new HttpError(400, "invalid alias name (a-z, 0-9, . _ -)");
  const full = `${loc}@${dom}`;
  if (await store.getAlias(full)) throw new HttpError(409, "alias already exists");
  return publicAlias(await store.createAlias(full, note, 0));
}

export async function setEnabled(store, idOrAddress, enabled) {
  const a = await findAlias(store, idOrAddress);
  return publicAlias(await store.updateAlias(a.id, { enabled: !!enabled }));
}

export async function findAlias(store, idOrAddress) {
  const a = /^\d+$/.test(String(idOrAddress))
    ? await store.getAliasById(idOrAddress)
    : await store.getAlias(String(idOrAddress || ""));
  if (!a) throw new HttpError(404, "alias not found");
  return a;
}

export async function sendFromAlias(store, env, { alias, to, subject, text, html }, fetchImpl = fetch) {
  const a = await findAlias(store, alias);
  if (!a.enabled) throw new HttpError(400, "alias is disabled");
  const rcpt = splitAddress(to);
  if (!rcpt) throw new HttpError(400, "invalid recipient");
  if (outboundMode(env) === "none") throw new HttpError(400, "No outbound transport: set RESEND_API_KEY or BREVO_API_KEY, or enable Cloudflare Email Sending");
  if (!subject || !(text || html)) throw new HttpError(400, "subject and text are required");
  const recipient = `${rcpt.local}@${rcpt.domain}`;
  const contact = await store.contactFor(a.id, recipient);
  try {
    const r = await sendExternal(env, { to: recipient, from: a.address, subject, text, html }, fetchImpl);
    await store.bump(a.id, "replied");
    await store.log({ alias_id: a.id, direction: "out", peer: recipient, subject, detail: r.via });
    return { ok: true, via: r.via, id: r.id, reverse: contact.token };
  } catch (e) {
    await store.log({ alias_id: a.id, direction: "error", peer: recipient, subject, detail: e.message });
    throw new HttpError(502, e.message);
  }
}
