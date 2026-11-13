import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCode, stripTrackers, makeLocal, isValidLocal, slugify, cleanReplySubject, safeEqual, displayName } from "../src/util.js";

test("extractCode: Chinese keyword", () => {
  assert.equal(extractCode("【淘宝】登录验证", "您的验证码是 482913，5分钟内有效。"), "482913");
  assert.equal(extractCode("", "验证码：7731，请勿泄露"), "7731");
});

test("extractCode: English keyword", () => {
  assert.equal(extractCode("Your GitHub launch code", "Your verification code is: 103-ish no. Code: 556677"), "556677");
  assert.equal(extractCode("Sign in to Slack", "Your confirmation code is ABC123"), "ABC123");
});

test("extractCode: subject fallback and no false positives", () => {
  assert.equal(extractCode("123456 is your Instagram code", ""), "123456");
  assert.equal(extractCode("Order shipped", "Order #20261101 shipped on 2026-11-01. Call 400-800-1234."), null);
  assert.equal(extractCode("Newsletter", "© 2026 Shop Inc. All rights reserved."), null);
});

test("stripTrackers removes 1x1 and known trackers only", () => {
  const html = `<p>hi</p><img src="https://x.com/logo.png" width="120"><img src="https://t.co/a.gif" width="1" height="1"><img src="https://abc.list-manage.com/track/open.php?u=1"><img style="display:none" src="https://y/p.gif">`;
  const r = stripTrackers(html);
  assert.equal(r.removed, 3);
  assert.match(r.html, /logo\.png/);
  assert.doesNotMatch(r.html, /t\.co|list-manage|p\.gif/);
});

test("alias names", () => {
  assert.equal(slugify("Taobao 购物!"), "taobao");
  assert.match(makeLocal("GitHub"), /^github\.[a-z2-9]{4}$/);
  assert.match(makeLocal(""), /^[a-z2-9]{8}$/);
  assert.ok(isValidLocal("shop.k3f9"));
  assert.ok(!isValidLocal("reply+abc"));
  assert.ok(!isValidLocal("a..b"));
  assert.ok(!isValidLocal(".x"));
});

test("misc helpers", () => {
  assert.equal(cleanReplySubject("Re: [482913] Your code"), "Re: Your code");
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.equal(displayName('Ev"il\r\n', "a@b.com"), "Evil (a at b.com)");
});

test("extractCode: code followed by sentence punctuation", () => {
  assert.equal(extractCode("Sign in", "Your login code is 482913."), "482913");
  assert.equal(extractCode("", "Your verification code is 7731. It expires in 10 minutes."), "7731");
  assert.equal(extractCode("Your code 482913.", ""), "482913");
  // decimals and versions are still not codes
  assert.equal(extractCode("", "Your code is 1234.56 USD"), null);
});
