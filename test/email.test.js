import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEmail } from "../src/email.js";
import { Store } from "../src/db.js";
import { baseEnv, fakeMessage, rawEmail } from "./helpers.js";

async function setup(over) {
  const env = baseEnv(over);
  const store = await new Store(env.DB).init();
  const sent = [];
  const external = [];
  const deps = {
    store,
    sendViaBinding: async (_env, msg) => {
      sent.push(msg);
      return { via: "cloudflare" };
    },
    sendExternal: async (_env, msg) => {
      external.push(msg);
      return { via: "resend" };
    },
  };
  return { env, store, sent, external, deps };
}

test("unknown address is auto-created and rewritten to destination", async () => {
  const { env, store, sent, deps } = await setup();
  const raw = rawEmail({ to: "taobao@example.com", subject: "登录验证", text: "您的验证码是 482913" });
  const msg = fakeMessage({ from: "news@shop.com", to: "taobao@example.com", raw });
  const r = await handleEmail(msg, env, {}, deps);
  assert.equal(r.action, "rewrite");
  assert.equal(r.code, "482913");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "me@gmail.com");
  assert.equal(sent[0].from, "taobao@example.com");
  assert.match(sent[0].replyTo, /^reply\+[a-z2-9]{16}@example\.com$/);
  assert.equal(sent[0].subject, "[482913] 登录验证");
  assert.match(sent[0].fromName, /Shop \(news at shop\.com\)/);
  const a = await store.getAlias("taobao@example.com");
  assert.equal(a.auto, 1);
  assert.equal(a.forwarded, 1);
  const code = await store.latestCode({ address: "taobao@example.com" });
  assert.equal(code.code, "482913");
});

test("AUTO_CREATE=false rejects unknown aliases", async () => {
  const { env, deps } = await setup({ AUTO_CREATE: "false" });
  const msg = fakeMessage({ from: "a@b.com", to: "nope@example.com", raw: rawEmail({ to: "nope@example.com" }) });
  const r = await handleEmail(msg, env, {}, deps);
  assert.equal(r.action, "reject");
  assert.ok(msg.rejected);
});

test("disabled alias is rejected and counted", async () => {
  const { env, store, sent, deps } = await setup();
  const a = await store.createAlias("spam@example.com");
  await store.updateAlias(a.id, { enabled: false });
  const msg = fakeMessage({ from: "a@b.com", to: "spam@example.com", raw: rawEmail({ to: "spam@example.com" }) });
  const r = await handleEmail(msg, env, {}, deps);
  assert.equal(r.reason, "disabled");
  assert.equal(sent.length, 0);
  assert.equal((await store.getAlias("spam@example.com")).blocked, 1);
});

test("wrong domain is rejected", async () => {
  const { env, deps } = await setup();
  const msg = fakeMessage({ from: "a@b.com", to: "x@other.com", raw: rawEmail({ to: "x@other.com" }) });
  assert.equal((await handleEmail(msg, env, {}, deps)).reason, "domain");
});

test("trackers stripped and counted", async () => {
  const { env, sent, deps } = await setup();
  const raw = rawEmail({ to: "n@example.com", html: '<p>Sale</p><img src="https://t.x/o.gif" width="1" height="1">' });
  const r = await handleEmail(fakeMessage({ from: "m@shop.com", to: "n@example.com", raw }), env, {}, deps);
  assert.equal(r.pixels, 1);
  assert.doesNotMatch(sent[0].html, /o\.gif/);
});

test("send failure falls back to plain forward", async () => {
  const { env, deps } = await setup();
  deps.sendViaBinding = async () => {
    throw new Error("E_SENDER_DOMAIN_NOT_AVAILABLE");
  };
  const msg = fakeMessage({ from: "a@b.com", to: "f@example.com", raw: rawEmail({ to: "f@example.com" }) });
  const r = await handleEmail(msg, env, {}, deps);
  assert.equal(r.action, "forward-fallback");
  assert.equal(msg.forwarded[0].rcpt, "me@gmail.com");
});

test("FORWARD_MODE=forward forwards untouched", async () => {
  const { env, sent, deps } = await setup({ FORWARD_MODE: "forward" });
  const msg = fakeMessage({ from: "a@b.com", to: "p@example.com", raw: rawEmail({ to: "p@example.com" }) });
  assert.equal((await handleEmail(msg, env, {}, deps)).action, "forward");
  assert.equal(sent.length, 0);
  assert.equal(msg.forwarded.length, 1);
});

test("owner reply goes out from the alias, real address hidden", async () => {
  const { env, sent, external, deps } = await setup();
  await handleEmail(fakeMessage({ from: "bob@corp.com", to: "job@example.com", raw: rawEmail({ from: "Bob <bob@corp.com>", to: "job@example.com", subject: "Offer" }) }), env, {}, deps);
  const replyTo = sent[0].replyTo;
  const reply = rawEmail({ from: "Me <me@gmail.com>", to: replyTo, subject: "Re: Offer", text: "Thanks! Reach me at me@gmail.com" });
  const r = await handleEmail(fakeMessage({ from: "me@gmail.com", to: replyTo, raw: reply }), env, {}, deps);
  assert.equal(r.action, "reply");
  assert.equal(external[0].to, "bob@corp.com");
  assert.equal(external[0].from, "job@example.com");
  assert.equal(external[0].subject, "Re: Offer");
  assert.doesNotMatch(external[0].text, /me@gmail\.com/);
  assert.match(external[0].text, /job@example\.com/);
});

test("strangers cannot use a reverse alias", async () => {
  const { env, sent, external, deps } = await setup();
  await handleEmail(fakeMessage({ from: "bob@corp.com", to: "job@example.com", raw: rawEmail({ to: "job@example.com" }) }), env, {}, deps);
  const replyTo = sent[0].replyTo;
  const msg = fakeMessage({ from: "evil@x.com", to: replyTo, raw: rawEmail({ from: "evil@x.com", to: replyTo }) });
  assert.equal((await handleEmail(msg, env, {}, deps)).reason, "not-owner");
  // spoofed envelope with failing DMARC
  const spoof = fakeMessage({ from: "me@gmail.com", to: replyTo, raw: rawEmail({ to: replyTo }), headers: { "authentication-results": "mx.cloudflare.net; dmarc=fail" } });
  assert.equal((await handleEmail(spoof, env, {}, deps)).reason, "not-owner");
  // bad token
  const bad = fakeMessage({ from: "me@gmail.com", to: "reply+zzzzzzzzzzzzzzzz@example.com", raw: rawEmail({}) });
  assert.equal((await handleEmail(bad, env, {}, deps)).reason, "bad-token");
  assert.equal(external.length, 0);
});

test("reply send failure is reported back to the owner", async () => {
  const { env, sent, deps } = await setup();
  deps.sendExternal = async () => {
    throw new Error("no transport");
  };
  await handleEmail(fakeMessage({ from: "bob@corp.com", to: "j@example.com", raw: rawEmail({ to: "j@example.com" }) }), env, {}, deps);
  const replyTo = sent[0].replyTo;
  const msg = fakeMessage({ from: "me@gmail.com", to: replyTo, raw: rawEmail({ from: "me@gmail.com", to: replyTo }) });
  const r = await handleEmail(msg, env, {}, deps);
  assert.equal(r.reason, "send-failed");
  assert.match(msg.rejected, /no transport/);
});
