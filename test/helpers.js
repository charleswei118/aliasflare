// Test doubles: a D1-compatible wrapper over node:sqlite and a fake EmailMessage.
import { DatabaseSync } from "node:sqlite";

class Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Stmt(this.db, this.sql, params);
  }
  async first() {
    const r = this.db.prepare(this.sql).get(...this.params);
    return r ? { ...r } : null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  return {
    _db: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

export function rawEmail({ from = "Shop <news@shop.com>", to = "x@example.com", subject = "Hello", text = "Hi there", html, extraHeaders = "" } = {}) {
  const headers = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <m1@shop.com>\r\nMIME-Version: 1.0\r\n${extraHeaders}`;
  if (!html) return `${headers}Content-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`;
  const b = "BOUNDARY42";
  return (
    `${headers}Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n` +
    `--${b}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n` +
    `--${b}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--${b}--\r\n`
  );
}

export function fakeMessage({ from, to, raw, headers = {} }) {
  const bytes = new TextEncoder().encode(raw);
  const m = {
    from,
    to,
    raw: new Response(bytes).body,
    rawSize: bytes.length,
    headers: new Headers(headers),
    rejected: null,
    forwarded: [],
    setReject(r) {
      this.rejected = r;
    },
    async forward(rcpt, h) {
      this.forwarded.push({ rcpt, headers: h });
    },
  };
  return m;
}

export function baseEnv(over = {}) {
  return {
    DOMAIN: "example.com",
    DESTINATION: "me@gmail.com",
    ADMIN_TOKEN: "test-token-123456",
    RESEND_API_KEY: "none",
    BREVO_API_KEY: "none",
    DB: fakeD1(),
    ...over,
  };
}
