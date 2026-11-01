// D1 data access. The schema is also created lazily on first use, so a deploy
// that skipped `wrangler d1 migrations apply` still works.

import { randomString } from "./util.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS aliases (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, auto INTEGER NOT NULL DEFAULT 0, forwarded INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, replied INTEGER NOT NULL DEFAULT 0, last_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, alias_id INTEGER NOT NULL REFERENCES aliases(id) ON DELETE CASCADE, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (alias_id, email))`,
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, alias_id INTEGER, direction TEXT NOT NULL, peer TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', code TEXT, pixels INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_messages_alias ON messages(alias_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_code ON messages(code, id)`,
];

const ready = new WeakSet();

export async function ensureSchema(db) {
  if (!db) throw new Error("D1 binding `DB` is missing. Check wrangler.toml.");
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

const MAX_MESSAGES = 1000;

export class Store {
  constructor(db) {
    this.db = db;
  }
  async init() {
    await ensureSchema(this.db);
    return this;
  }

  // ----- aliases -----
  getAlias(address) {
    return this.db.prepare("SELECT * FROM aliases WHERE address = ?").bind(address.toLowerCase()).first();
  }
  getAliasById(id) {
    return this.db.prepare("SELECT * FROM aliases WHERE id = ?").bind(Number(id)).first();
  }
  async listAliases({ q = "", limit = 200 } = {}) {
    const like = `%${String(q).toLowerCase()}%`;
    const r = await this.db
      .prepare("SELECT * FROM aliases WHERE address LIKE ? OR lower(note) LIKE ? ORDER BY id DESC LIMIT ?")
      .bind(like, like, Math.min(Number(limit) || 200, 1000))
      .all();
    return r.results || [];
  }
  async createAlias(address, note = "", auto = 0) {
    address = address.toLowerCase();
    await this.db
      .prepare("INSERT INTO aliases (address, note, auto) VALUES (?, ?, ?)")
      .bind(address, String(note).slice(0, 200), auto ? 1 : 0)
      .run();
    return this.getAlias(address);
  }
  async updateAlias(id, { enabled, note }) {
    const a = await this.getAliasById(id);
    if (!a) return null;
    await this.db
      .prepare("UPDATE aliases SET enabled = ?, note = ? WHERE id = ?")
      .bind(enabled === undefined ? a.enabled : enabled ? 1 : 0, note === undefined ? a.note : String(note).slice(0, 200), a.id)
      .run();
    return this.getAliasById(a.id);
  }
  async deleteAlias(id) {
    await this.db.batch([
      this.db.prepare("DELETE FROM contacts WHERE alias_id = ?").bind(Number(id)),
      this.db.prepare("DELETE FROM messages WHERE alias_id = ?").bind(Number(id)),
      this.db.prepare("DELETE FROM aliases WHERE id = ?").bind(Number(id)),
    ]);
  }
  // Counters and the log are best-effort: a failure here must never cause a
  // delivered message to be re-delivered or rejected.
  async bump(id, column) {
    if (!["forwarded", "blocked", "replied"].includes(column)) throw new Error("bad column");
    try {
      await this.db
        .prepare(`UPDATE aliases SET ${column} = ${column} + 1, last_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run();
    } catch (e) {
      console.error("bump failed", e);
    }
  }

  // ----- contacts (reverse aliases) -----
  async contactFor(aliasId, email, name = "") {
    email = email.toLowerCase();
    const found = await this.db
      .prepare("SELECT * FROM contacts WHERE alias_id = ? AND email = ?")
      .bind(aliasId, email)
      .first();
    if (found) return found;
    const token = randomString(16);
    await this.db
      .prepare("INSERT OR IGNORE INTO contacts (alias_id, email, name, token) VALUES (?, ?, ?, ?)")
      .bind(aliasId, email, String(name).slice(0, 120), token)
      .run();
    return this.db.prepare("SELECT * FROM contacts WHERE alias_id = ? AND email = ?").bind(aliasId, email).first();
  }
  contactByToken(token) {
    return this.db.prepare("SELECT * FROM contacts WHERE token = ?").bind(token.toLowerCase()).first();
  }

  // ----- message log -----
  async log(entry) {
    try {
      await this._log(entry);
    } catch (e) {
      console.error("log failed", e);
    }
  }
  async _log({ alias_id = null, direction, peer = "", subject = "", code = null, pixels = 0, detail = "" }) {
    await this.db
      .prepare("INSERT INTO messages (alias_id, direction, peer, subject, code, pixels, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(alias_id, direction, String(peer).slice(0, 200), String(subject).slice(0, 300), code, pixels, String(detail).slice(0, 500))
      .run();
    // keep the log bounded
    await this.db
      .prepare("DELETE FROM messages WHERE id <= (SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET ?)")
      .bind(MAX_MESSAGES)
      .run();
  }
  async listMessages({ alias_id, limit = 50 } = {}) {
    const lim = Math.min(Number(limit) || 50, 500);
    const sql =
      "SELECT m.*, a.address AS alias FROM messages m LEFT JOIN aliases a ON a.id = m.alias_id " +
      (alias_id ? "WHERE m.alias_id = ? " : "") +
      "ORDER BY m.id DESC LIMIT ?";
    const stmt = alias_id ? this.db.prepare(sql).bind(Number(alias_id), lim) : this.db.prepare(sql).bind(lim);
    return (await stmt.all()).results || [];
  }
  async latestCode({ address, sinceMinutes = 30 } = {}) {
    const mins = Math.max(1, Math.min(Number(sinceMinutes) || 30, 1440));
    const base =
      "SELECT m.code, m.peer, m.subject, m.created_at, a.address AS alias FROM messages m JOIN aliases a ON a.id = m.alias_id " +
      `WHERE m.code IS NOT NULL AND m.direction = 'in' AND m.created_at >= datetime('now', '-${mins} minutes') `;
    const stmt = address
      ? this.db.prepare(base + "AND a.address = ? ORDER BY m.id DESC LIMIT 1").bind(address.toLowerCase())
      : this.db.prepare(base + "ORDER BY m.id DESC LIMIT 1");
    return stmt.first();
  }
  async stats() {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS aliases, COALESCE(SUM(enabled),0) AS enabled, COALESCE(SUM(forwarded),0) AS forwarded, COALESCE(SUM(blocked),0) AS blocked, COALESCE(SUM(replied),0) AS replied FROM aliases")
      .first();
    return r;
  }
}
