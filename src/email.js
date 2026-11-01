// Inbound mail handler (Email Routing catch-all → this Worker).
//
//  stranger → shop.k3f9@your.domain  → forwarded to DESTINATION, From rewritten,
//                                      Reply-To = reply+<token>@your.domain
//  you → reply+<token>@your.domain   → sent to the stranger *as* shop.k3f9@your.domain

import PostalMime from "postal-mime";
import { Store } from "./db.js";
import { sendViaBinding, sendExternal, mapAttachments } from "./send.js";
import {
  REPLY_PREFIX, splitAddress, isValidLocal, parseDomains, flag, extractCode, stripTrackers,
  escapeHtml, replaceAllCI, cleanReplySubject, displayName,
} from "./util.js";

const MAX_RAW = 25 * 1024 * 1024;

export async function handleEmail(message, env, ctx, deps = {}) {
  const store = deps.store || (await new Store(env.DB).init());
  const dest = String(env.DESTINATION || "").trim().toLowerCase();
  const domains = parseDomains(env);
  const to = splitAddress(message.to);
  if (!dest || !to) {
    message.setReject("Mailbox not configured");
    return { action: "reject", reason: "not-configured" };
  }
  if (domains.length && !domains.includes(to.domain)) {
    message.setReject("Unknown domain");
    return { action: "reject", reason: "domain" };
  }

  if (to.local.startsWith(REPLY_PREFIX)) return handleReply(message, env, store, to, dest, deps);
  return handleIncoming(message, env, store, to, dest, deps);
}

async function parse(message) {
  if (message.rawSize && message.rawSize > MAX_RAW) throw new Error("message too large");
  return PostalMime.parse(message.raw, { attachmentEncoding: "arraybuffer" });
}

// ---------------- stranger → alias → you ----------------

async function handleIncoming(message, env, store, to, dest, deps) {
  const address = `${to.local}@${to.domain}`;
  let alias = await store.getAlias(address);

  if (!alias) {
    if (!flag(env.AUTO_CREATE, true) || !isValidLocal(to.local)) {
      message.setReject("Address does not exist");
      return { action: "reject", reason: "unknown" };
    }
    try {
      alias = await store.createAlias(address, "", 1);
    } catch {
      alias = await store.getAlias(address); // raced with another delivery
    }
  }

  const envelopeFrom = String(message.from || "").toLowerCase();
  if (!alias.enabled) {
    await store.bump(alias.id, "blocked");
    await store.log({ alias_id: alias.id, direction: "blocked", peer: envelopeFrom, subject: message.headers?.get?.("subject") || "" });
    message.setReject("Address does not exist");
    return { action: "reject", reason: "disabled" };
  }

  let email;
  try {
    email = await parse(message);
  } catch (e) {
    // Could not parse: deliver untouched rather than lose mail.
    await message.forward(dest);
    await store.bump(alias.id, "forwarded");
    await store.log({ alias_id: alias.id, direction: "in", peer: envelopeFrom, detail: `raw forward: ${e.message}` });
    return { action: "forward-raw" };
  }

  const sender = (email.from?.address || envelopeFrom || "").toLowerCase();
  const senderName = email.from?.name || "";
  const subject = email.subject || "";
  const code = extractCode(subject, email.text || "") || email.otp?.code || null;

  // Plain forwarding mode: no rewriting, no anonymous replies.
  if (String(env.FORWARD_MODE || "").toLowerCase() === "forward") {
    await message.forward(dest, new Headers({ "X-Aliasflare-Alias": address }));
    await store.bump(alias.id, "forwarded");
    await store.log({ alias_id: alias.id, direction: "in", peer: sender, subject, code });
    return { action: "forward", code };
  }

  const contact = await store.contactFor(alias.id, sender, senderName);
  const replyTo = `${REPLY_PREFIX}${contact.token}@${to.domain}`;
  const { html, removed } = flag(env.BLOCK_TRACKERS, true) ? stripTrackers(email.html) : { html: email.html, removed: 0 };

  const banner = flag(env.BANNER, true);
  const noteText = `→ ${address}${alias.note ? ` (${alias.note})` : ""} · from ${sender}${removed ? ` · ${removed} tracker(s) blocked` : ""}`;
  const text = banner ? `${noteText}\n\n${email.text || ""}` : email.text || "";
  const htmlOut = html
    ? banner
      ? `<div style="font:12px/1.4 -apple-system,Segoe UI,sans-serif;color:#666;border-bottom:1px solid #eee;padding:4px 0 6px;margin-bottom:10px">${escapeHtml(noteText)}</div>${html}`
      : html
    : undefined;
  const subj = code && flag(env.CODE_IN_SUBJECT, true) ? `[${code}] ${subject}` : subject;

  try {
    await (deps.sendViaBinding || sendViaBinding)(env, {
      to: dest,
      from: address,
      fromName: displayName(senderName, sender),
      replyTo,
      subject: subj,
      text,
      html: htmlOut,
      attachments: mapAttachments(email.attachments),
      headers: { "X-Aliasflare-Alias": address },
    });
  } catch (e) {
    // Sending failed (e.g. domain not onboarded for sending): fall back to a plain forward.
    await message.forward(dest, new Headers({ "X-Aliasflare-Alias": address }));
    await store.bump(alias.id, "forwarded");
    await store.log({ alias_id: alias.id, direction: "in", peer: sender, subject, code, pixels: removed, detail: `fallback forward: ${e.message}` });
    return { action: "forward-fallback", code, error: e.message };
  }

  await store.bump(alias.id, "forwarded");
  await store.log({ alias_id: alias.id, direction: "in", peer: sender, subject, code, pixels: removed });
  return { action: "rewrite", code, replyTo, pixels: removed };
}

// ---------------- you → reply+token → stranger ----------------

function authFailed(message) {
  const h = message.headers;
  if (!h?.get) return false;
  const ar = [h.get("authentication-results"), h.get("arc-authentication-results")].filter(Boolean).join(" ").toLowerCase();
  if (!ar) return false;
  if (/dmarc=fail/.test(ar)) return true;
  return /spf=(fail|softfail)/.test(ar) && !/dkim=pass/.test(ar);
}

async function handleReply(message, env, store, to, dest, deps) {
  const token = to.local.slice(REPLY_PREFIX.length);
  const contact = token ? await store.contactByToken(token) : null;
  if (!contact) {
    message.setReject("Address does not exist");
    return { action: "reject", reason: "bad-token" };
  }
  const from = String(message.from || "").toLowerCase();
  if (from !== dest || authFailed(message)) {
    // Only the owner may send through a reverse alias.
    message.setReject("Address does not exist");
    return { action: "reject", reason: "not-owner" };
  }
  const alias = await store.getAliasById(contact.alias_id);
  if (!alias || !alias.enabled) {
    message.setReject("Alias disabled");
    return { action: "reject", reason: "alias-disabled" };
  }

  const email = await parse(message);
  const hide = (s) => (s ? replaceAllCI(s, dest, alias.address) : s);
  const msg = {
    to: contact.email,
    from: alias.address,
    subject: cleanReplySubject(email.subject),
    text: hide(email.text),
    html: hide(email.html),
    attachments: mapAttachments(email.attachments),
    headers: {
      ...(email.inReplyTo ? { "In-Reply-To": email.inReplyTo } : {}),
      ...(email.references ? { References: String(email.references).slice(0, 2000) } : {}),
    },
  };
  if (!Object.keys(msg.headers).length) delete msg.headers;

  try {
    const r = await (deps.sendExternal || sendExternal)(env, msg);
    await store.bump(alias.id, "replied");
    await store.log({ alias_id: alias.id, direction: "out", peer: contact.email, subject: msg.subject, detail: r.via });
    return { action: "reply", via: r.via };
  } catch (e) {
    await store.log({ alias_id: alias.id, direction: "error", peer: contact.email, subject: msg.subject, detail: e.message });
    // Tell the owner instead of failing silently.
    message.setReject(`Reply not sent: ${e.message}`.slice(0, 200));
    return { action: "reject", reason: "send-failed", error: e.message };
  }
}
