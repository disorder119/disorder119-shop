import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountError,
  LOGIN_RATE_LIMIT_PER_HOUR,
  LOGIN_RATE_LIMIT_PER_IP_PER_HOUR,
  LOGIN_RATE_LIMIT_GLOBAL_PER_HOUR,
  handleAccountRequest,
  randomToken,
  redeemLoginToken,
  requestAccountDeletion,
  requestLoginLink,
  requestReturn,
  resolveSession,
  saveDefaultAddress,
  tokenFingerprint,
} from "./customer-account.js";

const ORIGIN = "https://disorder119.com";

const READY = {
  MAIL_API_KEY: "test-key",
  MAIL_FROM: "bestellung@disorder119.com",
};

// Ein kleiner Ersatz fuer D1: erkennt die tatsaechlich benutzten Anweisungen
// und haelt den Zustand in einfachen Listen. Das echte SQL samt Trigger prueft
// scripts/test_d1_migrations.py in SQLite.
function fakeDb(seed = {}) {
  const state = {
    loginTokens: seed.loginTokens ? [...seed.loginTokens] : [],
    sessions: seed.sessions ? [...seed.sessions] : [],
    customers: seed.customers ? [...seed.customers] : [],
    orders: seed.orders ? [...seed.orders] : [],
    orderItems: seed.orderItems ? [...seed.orderItems] : [],
    shipments: seed.shipments ? [...seed.shipments] : [],
    contacts: seed.contacts ? [...seed.contacts] : [],
    addresses: seed.addresses ? [...seed.addresses] : [],
    returns: seed.returns ? [...seed.returns] : [],
    privacy: seed.privacy ? [...seed.privacy] : [],
    statements: [],
  };

  function handle(sql, args) {
    const s = sql.replace(/\s+/g, " ").trim();
    state.statements.push(s);

    if (s.startsWith("SELECT COUNT(*) AS anzahl FROM customer_login_tokens WHERE email_normalized=?")) {
      const [email, since] = args;
      return { first: { anzahl: state.loginTokens.filter(t => t.email_normalized === email && t.created_at >= since).length } };
    }
    if (s.startsWith("SELECT COUNT(*) AS anzahl FROM customer_login_tokens WHERE request_ip_hash=?")) {
      const [ipHash, since] = args;
      return { first: { anzahl: state.loginTokens.filter(t => t.request_ip_hash === ipHash && t.created_at >= since).length } };
    }
    if (s.startsWith("SELECT COUNT(*) AS anzahl FROM customer_login_tokens WHERE created_at>=?")) {
      const [since] = args;
      return { first: { anzahl: state.loginTokens.filter(t => t.created_at >= since).length } };
    }
    if (s.startsWith("INSERT INTO customer_login_tokens")) {
      const [id, email, created, expires, ipHash] = args;
      // Der Trigger der Migration haelt je Adresse nur den neuesten Link.
      state.loginTokens = state.loginTokens.filter(t => t.email_normalized !== email);
      state.loginTokens.push({ id, email_normalized: email, created_at: created, expires_at: expires, request_ip_hash: ipHash, used_at: null });
      return { changes: 1 };
    }
    if (s.startsWith("SELECT id,email_normalized,expires_at,used_at FROM customer_login_tokens")) {
      return { first: state.loginTokens.find(t => t.id === args[0]) || null };
    }
    if (s.startsWith("UPDATE customer_login_tokens SET used_at=?")) {
      const row = state.loginTokens.find(t => t.id === args[1] && !t.used_at);
      if (!row) return { changes: 0 };
      row.used_at = args[0];
      return { changes: 1 };
    }
    if (s.startsWith("SELECT id,status FROM customers")) {
      return { first: state.customers.find(c => c.email_normalized === args[0]) || null };
    }
    if (s.startsWith("INSERT INTO customers")) {
      const [id, , email] = args;
      state.customers.push({ id, email_normalized: email, status: "ACTIVE" });
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE customers SET email_verified=1")) return { changes: 1 };
    if (s.startsWith("UPDATE customers SET status='DELETION_PENDING'")) {
      const row = state.customers.find(c => c.id === args[1]);
      if (row) row.status = "DELETION_PENDING";
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE commerce_orders SET customer_id=?")) {
      const [customerId, , email] = args;
      const owned = state.contacts.filter(c => String(c.email).toLowerCase() === email).map(c => c.order_id);
      let changes = 0;
      for (const order of state.orders) {
        if (!order.customer_id && owned.includes(order.id)) {
          order.customer_id = customerId;
          changes += 1;
        }
      }
      return { changes };
    }
    if (s.startsWith("INSERT INTO customer_sessions")) {
      const [id, customerId, created, expires, seen] = args;
      state.sessions.push({ id, customer_id: customerId, created_at: created, expires_at: expires, last_seen_at: seen, revoked_at: null });
      return { changes: 1 };
    }
    if (s.startsWith("SELECT s.id,s.customer_id,s.expires_at,s.revoked_at")) {
      const session = state.sessions.find(x => x.id === args[0]);
      if (!session) return { first: null };
      const customer = state.customers.find(c => c.id === session.customer_id);
      if (!customer) return { first: null };
      return { first: { ...session, email_normalized: customer.email_normalized, status: customer.status } };
    }
    if (s.startsWith("UPDATE customer_sessions SET last_seen_at=?")) return { changes: 1 };
    if (s.startsWith("UPDATE customer_sessions SET revoked_at=? WHERE id=?")) {
      const row = state.sessions.find(x => x.id === args[1]);
      if (row) row.revoked_at = args[0];
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE customer_sessions SET revoked_at=? WHERE customer_id=?")) {
      for (const row of state.sessions.filter(x => x.customer_id === args[1])) row.revoked_at = args[0];
      return { changes: 1 };
    }
    if (s.startsWith("SELECT id,order_number,status,currency")) {
      return { all: state.orders.filter(o => o.customer_id === args[0]) };
    }
    if (s.startsWith("SELECT order_id,item_id,article_no")) {
      return { all: state.orderItems.filter(i => args.includes(i.order_id)) };
    }
    if (s.startsWith("SELECT order_id,carrier,status,tracking_number")) {
      return { all: state.shipments.filter(i => args.includes(i.order_id)) };
    }
    if (s.startsWith("SELECT id,status,created_at FROM commerce_orders")) {
      return { first: state.orders.find(o => o.id === args[0] && o.customer_id === args[1]) || null };
    }
    if (s.startsWith("SELECT id,status FROM returns")) {
      return { first: state.returns.find(r => r.order_id === args[0] && !["CLOSED", "REJECTED"].includes(r.status)) || null };
    }
    if (s.startsWith("INSERT INTO returns")) {
      state.returns.push({ id: args[0], order_id: args[1], status: "REQUESTED", reason_code: args[2] });
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE commerce_orders SET status='RETURN_REQUESTED'")) {
      const row = state.orders.find(o => o.id === args[1]);
      if (row) row.status = "RETURN_REQUESTED";
      return { changes: 1 };
    }
    if (s.startsWith("SELECT id,label,recipient_name")) {
      return { all: state.addresses };
    }
    if (s.startsWith("SELECT id FROM customer_addresses")) {
      return { first: state.addresses.find(a => a.is_default === 1) || null };
    }
    if (s.startsWith("INSERT INTO customer_addresses")) {
      state.addresses.push({ id: args[0], recipient_name: args[3], address_line1: args[4], postal_code: args[6], city: args[7], country_code: args[9], is_default: 1 });
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE customer_addresses SET")) return { changes: 1 };
    if (s.startsWith("SELECT id FROM account_privacy_requests")) {
      return { first: state.privacy.find(p => p.customer_id === args[0]) || null };
    }
    if (s.startsWith("INSERT INTO account_privacy_requests")) {
      state.privacy.push({ id: args[0], customer_id: args[1], status: "REQUESTED" });
      return { changes: 1 };
    }
    throw new Error(`Unerwartete Anweisung im Test: ${s.slice(0, 90)}`);
  }

  state.prepare = sql => ({
    bind: (...args) => ({
      async first() { return handle(sql, args).first ?? null; },
      async all() { return { results: handle(sql, args).all || [] }; },
      async run() { return { meta: { changes: handle(sql, args).changes ?? 1 } }; },
    }),
  });
  return state;
}

function stubMail() {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: "<x>" }), { status: 201 });
  };
  return { sent, restore() { globalThis.fetch = original; } };
}

test("tokens are long, random and never stored in clear text", async () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, `Token zu kurz: ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  const fingerprint = await tokenFingerprint(a);
  assert.equal(fingerprint.length, 64);
  assert.notEqual(fingerprint, a);
  assert.equal(fingerprint, await tokenFingerprint(a));
});

test("a broken address produces neither a token nor a mail", async () => {
  const db = fakeDb();
  const mail = stubMail();
  try {
    const result = await requestLoginLink({ ...READY, DB: db }, "kein-postfach", "req-1");
    assert.deepEqual(result, { queued: false, reason: "INVALID_EMAIL" });
    assert.equal(db.loginTokens.length, 0);
    assert.equal(mail.sent.length, 0);
  } finally {
    mail.restore();
  }
});

test("the login mail carries the link and only one link stays valid", async () => {
  const db = fakeDb();
  const mail = stubMail();
  try {
    await requestLoginLink({ ...READY, DB: db }, "Kundin@Example.com", "req-2");
    await requestLoginLink({ ...READY, DB: db }, "kundin@example.com", "req-3");
    assert.equal(mail.sent.length, 2);
    assert.equal(db.loginTokens.length, 1);
    assert.match(mail.sent[0].subject, /Anmeldelink/);
    assert.match(mail.sent[0].textContent, /anmeldung=/);
    // Das Token steht im Link, der Abdruck in der Datenbank - nie andersherum.
    const link = /anmeldung=([A-Za-z0-9_%-]+)/.exec(mail.sent[1].textContent)[1];
    assert.equal(db.loginTokens[0].id, await tokenFingerprint(decodeURIComponent(link)));
  } finally {
    mail.restore();
  }
});

test("a postbox cannot be flooded with login links", async () => {
  const bestehend = Array.from({ length: LOGIN_RATE_LIMIT_PER_HOUR }, (_, i) => ({
    id: `alt-${i}`,
    email_normalized: "kundin@example.com",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    used_at: null,
  }));
  const db = fakeDb({ loginTokens: bestehend });
  const mail = stubMail();
  try {
    const result = await requestLoginLink({ ...READY, DB: db }, "kundin@example.com", "req-4");
    assert.deepEqual(result, { queued: false, reason: "RATE_LIMITED" });
    assert.equal(mail.sent.length, 0);
  } finally {
    mail.restore();
  }
});

test("one source cannot spray login links across many foreign addresses", async () => {
  // Gleiche Quelle (IP-Abdruck), viele unterschiedliche Zieladressen: der
  // Adress-Zaehler allein wuerde das nie sehen. Der IP-Deckel muss greifen.
  const bestehend = Array.from({ length: LOGIN_RATE_LIMIT_PER_IP_PER_HOUR }, (_, i) => ({
    id: `ip-${i}`,
    email_normalized: `opfer${i}@example.com`,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    request_ip_hash: "angreifer-ip",
    used_at: null,
  }));
  const db = fakeDb({ loginTokens: bestehend });
  const mail = stubMail();
  try {
    const result = await requestLoginLink({ ...READY, DB: db }, "neues-opfer@example.com", "req-ip", "angreifer-ip");
    assert.deepEqual(result, { queued: false, reason: "RATE_LIMITED" });
    assert.equal(mail.sent.length, 0);
  } finally {
    mail.restore();
  }
});

test("a global hourly cap bounds the total volume of login mails", async () => {
  const bestehend = Array.from({ length: LOGIN_RATE_LIMIT_GLOBAL_PER_HOUR }, (_, i) => ({
    id: `global-${i}`,
    email_normalized: `konto${i}@example.com`,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    request_ip_hash: `ip-${i}`,
    used_at: null,
  }));
  const db = fakeDb({ loginTokens: bestehend });
  const mail = stubMail();
  try {
    const result = await requestLoginLink({ ...READY, DB: db }, "noch-jemand@example.com", "req-global", "frische-ip");
    assert.deepEqual(result, { queued: false, reason: "RATE_LIMITED" });
    assert.equal(mail.sent.length, 0);
  } finally {
    mail.restore();
  }
});

test("the answer is identical whether an account exists or not", async () => {
  const mail = stubMail();
  try {
    const bekannt = fakeDb({ customers: [{ id: "c1", email_normalized: "kundin@example.com", status: "ACTIVE" }] });
    const unbekannt = fakeDb();
    const url = new URL("https://worker.example/account/login");
    const antwort = async db => {
      const response = await handleAccountRequest(
        new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "kundin@example.com" }) }),
        { ...READY, DB: db }, url, "req-5", ORIGIN,
      );
      return { status: response.status, body: await response.json() };
    };
    const a = await antwort(bekannt);
    const b = await antwort(unbekannt);
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body);
  } finally {
    mail.restore();
  }
});

async function seedLogin(extra = {}) {
  const token = randomToken();
  const db = fakeDb({
    loginTokens: [{
      id: await tokenFingerprint(token),
      email_normalized: "kundin@example.com",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used_at: null,
      ...extra,
    }],
    ...(extra.seed || {}),
  });
  return { token, db };
}

test("a valid link creates a session and attaches earlier guest orders", async () => {
  const token = randomToken();
  const db = fakeDb({
    loginTokens: [{
      id: await tokenFingerprint(token),
      email_normalized: "kundin@example.com",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used_at: null,
    }],
    orders: [{ id: "o1", customer_id: null, order_number: "D119-1", status: "PAID", currency: "EUR", subtotal_cents: 1000, shipping_cents: 590, total_cents: 1590, created_at: "2026-09-01T00:00:00Z" }],
    contacts: [{ order_id: "o1", email: "Kundin@Example.com" }],
  });
  const result = await redeemLoginToken({ ...READY, DB: db }, token, "req-6");
  assert.equal(result.email, "kundin@example.com");
  assert.ok(result.session.length >= 40);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].id, await tokenFingerprint(result.session));
  assert.equal(db.orders[0].customer_id, result.customerId);
});

test("the same login link cannot be used twice", async () => {
  const { token, db } = await seedLogin();
  await redeemLoginToken({ ...READY, DB: db }, token, "req-7");
  await assert.rejects(
    () => redeemLoginToken({ ...READY, DB: db }, token, "req-8"),
    err => err instanceof AccountError && err.code === "LOGIN_TOKEN_ALREADY_USED" && err.status === 401,
  );
  assert.equal(db.sessions.length, 1);
});

test("an expired link is refused", async () => {
  const { token, db } = await seedLogin({ expires_at: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(
    () => redeemLoginToken({ ...READY, DB: db }, token, "req-9"),
    err => err instanceof AccountError && err.code === "LOGIN_TOKEN_EXPIRED",
  );
  assert.equal(db.sessions.length, 0);
});

test("a guessed link is refused without revealing anything", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => redeemLoginToken({ ...READY, DB: db }, randomToken(), "req-10"),
    err => err instanceof AccountError && err.code === "LOGIN_TOKEN_INVALID" && err.status === 401,
  );
});

async function sessionSetup(overrides = {}) {
  const token = randomToken();
  const db = fakeDb({
    customers: [{ id: "c1", email_normalized: "kundin@example.com", status: "ACTIVE", ...(overrides.customer || {}) }],
    sessions: [{
      id: await tokenFingerprint(token),
      customer_id: "c1",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      revoked_at: null,
      ...(overrides.session || {}),
    }],
    ...(overrides.seed || {}),
  });
  return { token, db, env: { ...READY, DB: db } };
}

test("a session is accepted from the cookie and from the header", async () => {
  const { token, env } = await sessionSetup();
  const viaCookie = await resolveSession(env, new Request("https://worker.example/account/orders", {
    headers: { Cookie: `d119_session=${encodeURIComponent(token)}` },
  }));
  const viaHeader = await resolveSession(env, new Request("https://worker.example/account/orders", {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(viaCookie.customerId, "c1");
  assert.equal(viaHeader.email, "kundin@example.com");
});

test("expired, revoked and missing sessions are all refused", async () => {
  const ohne = await sessionSetup();
  await assert.rejects(
    () => resolveSession(ohne.env, new Request("https://worker.example/account/orders")),
    err => err.code === "NOT_AUTHENTICATED" && err.status === 401,
  );

  const abgelaufen = await sessionSetup({ session: { expires_at: new Date(Date.now() - 1000).toISOString() } });
  await assert.rejects(
    () => resolveSession(abgelaufen.env, new Request("https://worker.example/account/orders", {
      headers: { Authorization: `Bearer ${abgelaufen.token}` },
    })),
    err => err.code === "SESSION_EXPIRED",
  );

  const widerrufen = await sessionSetup({ session: { revoked_at: new Date().toISOString() } });
  await assert.rejects(
    () => resolveSession(widerrufen.env, new Request("https://worker.example/account/orders", {
      headers: { Authorization: `Bearer ${widerrufen.token}` },
    })),
    err => err.code === "NOT_AUTHENTICATED",
  );

  const gesperrt = await sessionSetup({ customer: { status: "DELETION_PENDING" } });
  await assert.rejects(
    () => resolveSession(gesperrt.env, new Request("https://worker.example/account/orders", {
      headers: { Authorization: `Bearer ${gesperrt.token}` },
    })),
    err => err.code === "ACCOUNT_DISABLED" && err.status === 403,
  );
});

test("the order list carries item id, prices and tracking link", async () => {
  const { token, env } = await sessionSetup({
    seed: {
      orders: [{ id: "o1", customer_id: "c1", order_number: "D119-1", status: "SHIPPED", currency: "EUR", subtotal_cents: 38000, shipping_cents: 590, total_cents: 38590, created_at: "2026-09-01T00:00:00Z" }],
      orderItems: [{ order_id: "o1", item_id: 9499, article_no: "119-42", title_snapshot: "Isaac Sellam", unit_price_cents: 38000 }],
      shipments: [{ order_id: "o1", carrier: "DHL", status: "SHIPPED", tracking_number: "00340434161234567890", shipped_at: "2026-09-02T00:00:00Z", delivered_at: null }],
    },
  });
  const url = new URL("https://worker.example/account/orders");
  const response = await handleAccountRequest(
    new Request(url, { headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN } }),
    env, url, "req-11", ORIGIN,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].items[0].itemId, 9499);
  assert.equal(body.orders[0].shippingCents, 590);
  assert.match(body.orders[0].shipment.trackingUrl, /dhl\.de.*00340434161234567890/);
});

test("a foreign order can neither be seen nor withdrawn", async () => {
  const { env } = await sessionSetup({
    seed: { orders: [{ id: "fremd", customer_id: "c2", order_number: "D119-2", status: "PAID", currency: "EUR", subtotal_cents: 100, shipping_cents: 590, total_cents: 690, created_at: "2026-09-01T00:00:00Z" }] },
  });
  await assert.rejects(
    () => requestReturn(env, "c1", "fremd"),
    err => err.code === "ORDER_NOT_FOUND" && err.status === 404,
  );
});

test("a withdrawal is recorded once and marks the order", async () => {
  const { env, db } = await sessionSetup({
    seed: { orders: [{ id: "o1", customer_id: "c1", order_number: "D119-1", status: "DELIVERED", currency: "EUR", subtotal_cents: 100, shipping_cents: 590, total_cents: 690, created_at: "2026-09-01T00:00:00Z" }] },
  });
  const erste = await requestReturn(env, "c1", "o1", "WITHDRAWAL");
  assert.equal(erste.created, true);
  assert.ok(erste.declaredAt, "Zeitpunkt der Erklaerung fehlt");
  assert.equal(db.orders[0].status, "RETURN_REQUESTED");

  const zweite = await requestReturn(env, "c1", "o1");
  assert.equal(zweite.created, false);
  assert.equal(db.returns.length, 1);
});

test("an unpaid order cannot be withdrawn", async () => {
  const { env } = await sessionSetup({
    seed: { orders: [{ id: "o1", customer_id: "c1", order_number: "D119-1", status: "PAYMENT_PENDING", currency: "EUR", subtotal_cents: 100, shipping_cents: 590, total_cents: 690, created_at: "2026-09-01T00:00:00Z" }] },
  });
  await assert.rejects(
    () => requestReturn(env, "c1", "o1"),
    err => err.code === "ORDER_NOT_RETURNABLE" && err.status === 409,
  );
});

test("an incomplete address is refused instead of half saved", async () => {
  const { env, db } = await sessionSetup();
  await assert.rejects(
    () => saveDefaultAddress(env, "c1", { recipientName: "A. Beispiel", city: "Aschaffenburg" }),
    err => err.code === "ADDRESS_INCOMPLETE" && err.status === 400,
  );
  assert.equal(db.addresses.length, 0);

  const saved = await saveDefaultAddress(env, "c1", {
    recipientName: "A. Beispiel",
    addressLine1: "Musterweg 3",
    postalCode: "63739",
    city: "Aschaffenburg",
  });
  assert.equal(saved.created, true);
  assert.equal(db.addresses.length, 1);
  assert.equal(db.addresses[0].country_code, "DE");
});

test("a deletion request locks the account and ends every session", async () => {
  const { env, db } = await sessionSetup();
  const result = await requestAccountDeletion(env, "c1");
  assert.equal(result.requested, true);
  assert.equal(db.customers[0].status, "DELETION_PENDING");
  assert.ok(db.sessions.every(s => s.revoked_at), "Sitzungen laufen nach dem Loeschwunsch weiter");
  assert.equal(db.privacy.length, 1);
});

test("requests without a session and from foreign origins are refused", async () => {
  const { env } = await sessionSetup();
  const url = new URL("https://worker.example/account/orders");

  const ohneSitzung = await handleAccountRequest(
    new Request(url, { headers: { Origin: ORIGIN } }), env, url, "req-12", ORIGIN,
  );
  assert.equal(ohneSitzung.status, 401);

  const fremd = await handleAccountRequest(
    new Request(url, { headers: { Origin: "https://boese.example" } }), env, url, "req-13", "https://boese.example",
  );
  assert.equal(fremd.status, 403);
  assert.equal((await fremd.json()).error, "ORIGIN_NOT_ALLOWED");
});

test("the session cookie cannot be read by scripts and is not sent cross-site", async () => {
  const token = randomToken();
  const db = fakeDb({
    loginTokens: [{
      id: await tokenFingerprint(token),
      email_normalized: "kundin@example.com",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used_at: null,
    }],
  });
  const url = new URL("https://worker.example/account/session");
  const response = await handleAccountRequest(
    new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ token }) }),
    { ...READY, DB: db }, url, "req-14", ORIGIN,
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});
