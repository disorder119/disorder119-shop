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
