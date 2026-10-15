import test from "node:test";
import assert from "node:assert/strict";
import { privateIpHash, ipPepper } from "./privacy-security.js";

test("live IP protection fails closed without a long server secret", async () => {
  for (const pepper of [undefined, "d119", "too-short"]) {
    assert.throws(() => ipPepper({PAYPAL_ENVIRONMENT:"live", LOGIN_IP_PEPPER:pepper}),
      {code:"IP_PRIVACY_NOT_CONFIGURED", status:503});
  }
});
test("IP hashes use separate purposes and change when the private secret changes", async () => {
  const request = new Request("https://api.disorder119.com/", {headers:{"CF-Connecting-IP":"192.0.2.8"}});
  const env = {PAYPAL_ENVIRONMENT:"live", LOGIN_IP_PEPPER:"x".repeat(64)};
  const one = await privateIpHash(request, env, "account");
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, await privateIpHash(request, env, "newsletter"));
  assert.notEqual(one, await privateIpHash(request, {...env,LOGIN_IP_PEPPER:"y".repeat(64)}, "account"));
  assert.equal(await privateIpHash(new Request(request.url), env, "account"), null);
});

import { anschlussVonIp, privateNetzHash } from "./privacy-security.js";

test("limits count per connection: IPv6 per /64, IPv4 and mapped IPv4 per address", async () => {
  assert.equal(anschlussVonIp("192.0.2.8"), "192.0.2.8");
  assert.equal(anschlussVonIp("::ffff:192.0.2.8"), "192.0.2.8");
  assert.equal(anschlussVonIp("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(anschlussVonIp("2001:DB8:0001:0002::ffff"), "2001:db8:1:2::/64");
  assert.equal(anschlussVonIp("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(anschlussVonIp(""), "");
  const env = {PAYPAL_ENVIRONMENT:"live", LOGIN_IP_PEPPER:"x".repeat(64)};
  const hash = ip => privateNetzHash(new Request("https://api.disorder119.com/", {headers:{"CF-Connecting-IP":ip}}), env, "spiel-code");
  assert.match(await hash("2001:db8:1:2::1"), /^[0-9a-f]{64}$/);
  assert.equal(await hash("2001:db8:1:2::1"), await hash("2001:db8:1:2:aaaa::9"));
  assert.notEqual(await hash("2001:db8:1:2::1"), await hash("2001:db8:1:3::1"));
  assert.notEqual(await hash("192.0.2.8"), await privateIpHash(new Request("https://x/", {headers:{"CF-Connecting-IP":"192.0.2.8"}}), env, "spiel-code"));
  assert.equal(await privateNetzHash(new Request("https://x/"), env, "spiel-code"), null);
  await assert.rejects(() => privateNetzHash(new Request("https://x/", {headers:{"CF-Connecting-IP":"192.0.2.8"}}), {PAYPAL_ENVIRONMENT:"live"}, "spiel-code"),
    {code:"IP_PRIVACY_NOT_CONFIGURED"});
});
