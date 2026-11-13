// Pure helpers: no Cloudflare APIs here, so everything is unit-testable in Node.

export const REPLY_PREFIX = "reply+";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1

export function randomString(len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** Constant-time string comparison (for the admin token). */
export function safeEqual(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function splitAddress(addr) {
  const s = String(addr || "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  return { local: s.slice(0, at), domain: s.slice(at + 1) };
}

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function isValidLocal(local) {
  return LOCAL_RE.test(local) && !local.includes("..") && !local.startsWith(REPLY_PREFIX);
}

/** Turn a note like "Taobao 购物" into a short ASCII prefix: "taobao". */
export function slugify(note) {
  return String(note || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/g, "");
}

/** Build a new alias local part: "<slug>.<rand4>" or "<rand8>". */
export function makeLocal(note) {
  const slug = slugify(note);
  return slug ? `${slug}.${randomString(4)}` : randomString(8);
}

export function parseDomains(env) {
  return String(env.DOMAIN || "")
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isUnset(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || s === "none" || s === "-" || s === "false" || s === "no";
}

export function flag(v, dflt) {
  if (v === undefined || v === null || v === "") return dflt;
  return !["false", "0", "no", "off"].includes(String(v).trim().toLowerCase());
}

// ---------- verification codes ----------

const CODE_KEYWORDS =
  /(验证码|校验码|动态码|确认码|激活码|安全码|登录码|一次性密码|驗證碼|認證碼|verification code|security code|confirmation code|login code|sign[- ]?in code|one[- ]time (?:code|password|passcode)|passcode|otp|your code|code is|code:|código|code de|bestätigungscode|認証コード|確認コード|인증번호)/i;

/**
 * Find a one-time code in a subject + body. Returns the code string or null.
 * Looks for a code-ish token shortly after a keyword; falls back to a lone
 * 6-digit number in the subject.
 */
export function extractCode(subject = "", text = "") {
  const hay = `${subject}\n${text}`.slice(0, 20000);
  const re = new RegExp(CODE_KEYWORDS.source, "gi");
  let m;
  while ((m = re.exec(hay))) {
    const window = hay.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const digits = window.match(/(?<![\w.:/-])(\d{4,8})(?![\w:/-]|\.\d|\d)/);
    if (digits && !isLikelyYear(digits[1], window)) return digits[1];
    const mixed = window.match(/(?<![\w-])([A-Z0-9]{5,8})(?![\w-])/);
    if (mixed && /\d/.test(mixed[1]) && /[A-Z]/.test(mixed[1])) return mixed[1];
  }
  const subj = String(subject).match(/(?<![\w.:/-])(\d{6})(?![\w:/-]|\.\d|\d)/);
  return subj ? subj[1] : null;
}

function isLikelyYear(d, window) {
  return d.length === 4 && /^(19|20)\d\d$/.test(d) && /年|\byear\b|©/i.test(window);
}

// ---------- tracking pixels ----------

const TRACKER_HOSTS = [
  "list-manage.com", "mailchimp.com", "sendgrid.net", "mandrillapp.com", "hubspot", "hs-analytics",
  "mailgun", "mixpanel", "google-analytics.com", "doubleclick.net", "customer.io", "intercom",
  "klaviyo", "exacttarget", "sailthru", "pardot", "marketo", "mktoweb", "braze", "sparkpost",
  "mailtrack", "yesware", "bananatag", "getnotify", "returnpath", "litmus.com", "emltrk",
  "open.aspx", "/open?", "/track/open", "/o.gif", "pixel.gif", "beacon",
];

/** Remove tracking pixels from HTML. Returns { html, removed }. */
export function stripTrackers(html) {
  if (!html) return { html, removed: 0 };
  let removed = 0;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const lower = tag.toLowerCase();
    const w = attr(lower, "width");
    const h = attr(lower, "height");
    const tiny = (w !== null && Number(w) <= 2) || (h !== null && Number(h) <= 2);
    const hidden = /display\s*:\s*none|visibility\s*:\s*hidden|(?:^|[;\s"'])(?:width|height)\s*:\s*[01]px/.test(lower);
    const src = attr(lower, "src") || "";
    const tracker = TRACKER_HOSTS.some((t) => src.includes(t));
    if (tiny || hidden || tracker) {
      removed++;
      return "";
    }
    return tag;
  });
  return { html: out, removed };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Replace every occurrence of `needle` (case-insensitive) in text. */
export function replaceAllCI(text, needle, replacement) {
  if (!text || !needle) return text;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return text.replace(re, replacement);
}

/** Strip our own "[123456] " code prefix from a reply subject. */
export function cleanReplySubject(subject) {
  return String(subject || "").replace(/\[(?:[0-9]{4,8}|[A-Z0-9]{5,8})\]\s*/, "").trim();
}

/** "Alice <a@b.com>" for display names; keep it short and header-safe. */
export function displayName(name, address) {
  const n = String(name || "").replace(/[\r\n"<>]/g, "").trim();
  const a = String(address || "").replace(/[\r\n"<>]/g, "").trim();
  const label = n ? `${n} (${a.replace("@", " at ")})` : a.replace("@", " at ");
  return label.slice(0, 120);
}
