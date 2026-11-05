// Outbound mail. Three transports:
//  - Resend HTTP API (free tier: 3,000/month) when RESEND_API_KEY is set
//  - Brevo HTTP API (free tier: 300/day) when BREVO_API_KEY is set
//  - Cloudflare Email Sending binding `EMAIL` otherwise (arbitrary recipients need Workers Paid)
// Mail to your own verified destination address always goes through `EMAIL`, which is free.

import { isUnset } from "./util.js";

function toBase64(content) {
  if (typeof content === "string") return content;
  const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function mapAttachments(list = [], maxBytes = 20 * 1024 * 1024) {
  const out = [];
  let total = 0;
  for (const a of list) {
    if (!a?.content) continue;
    const size = a.content.byteLength ?? a.content.length ?? 0;
    if (total + size > maxBytes || out.length >= 30) break;
    total += size;
    out.push({
      content: toBase64(a.content),
      filename: String(a.filename || "attachment").replace(/[\r\n/\\]/g, "_").slice(0, 150),
      type: /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType || "") ? a.mimeType : "application/octet-stream",
      disposition: a.disposition === "inline" && a.contentId ? "inline" : "attachment",
      ...(a.disposition === "inline" && a.contentId ? { contentId: String(a.contentId).replace(/[<>\s]/g, "") } : {}),
    });
  }
  return out;
}

/** Send via the Cloudflare binding. Throws on failure. */
export async function sendViaBinding(env, msg) {
  if (!env.EMAIL?.send) throw new Error("send_email binding `EMAIL` is not configured");
  const r = await env.EMAIL.send({
    to: msg.to,
    from: msg.fromName ? { email: msg.from, name: msg.fromName } : msg.from,
    subject: msg.subject || "(no subject)",
    ...(msg.text ? { text: msg.text } : {}),
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
  });
  return { id: r?.messageId || null, via: "cloudflare" };
}

/** Send via Resend. Throws on failure. */
export async function sendViaResend(env, msg, fetchImpl = fetch) {
  const from = msg.fromName ? `"${msg.fromName.replace(/"/g, "")}" <${msg.from}>` : msg.from;
  const body = {
    from,
    to: [msg.to],
    subject: msg.subject || "(no subject)",
    ...(msg.text ? { text: msg.text } : {}),
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
    ...(msg.attachments?.length
      ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.type, ...(a.contentId ? { content_id: a.contentId } : {}) })) }
      : {}),
  };
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.name || "send failed"}`);
  return { id: data.id || null, via: "resend" };
}

/** Send via Brevo. Throws on failure. */
export async function sendViaBrevo(env, msg, fetchImpl = fetch) {
  const body = {
    sender: { email: msg.from, ...(msg.fromName ? { name: msg.fromName } : {}) },
    to: [{ email: msg.to }],
    subject: msg.subject || "(no subject)",
    ...(msg.text ? { textContent: msg.text } : {}),
    ...(msg.html ? { htmlContent: msg.html } : {}),
    ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
    ...(msg.attachments?.length ? { attachment: msg.attachments.map((a) => ({ name: a.filename, content: a.content })) } : {}),
  };
  const res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${data.message || data.code || "send failed"}`);
  return { id: data.messageId || null, via: "brevo" };
}

/** Send to an arbitrary recipient (replies / new mail from an alias). */
export function sendExternal(env, msg, fetchImpl = fetch) {
  if (!isUnset(env.RESEND_API_KEY)) return sendViaResend(env, msg, fetchImpl);
  if (!isUnset(env.BREVO_API_KEY)) return sendViaBrevo(env, msg, fetchImpl);
  return sendViaBinding(env, msg);
}

export function outboundMode(env) {
  if (!isUnset(env.RESEND_API_KEY)) return "resend";
  if (!isUnset(env.BREVO_API_KEY)) return "brevo";
  if (env.EMAIL?.send) return "cloudflare";
  return "none";
}
