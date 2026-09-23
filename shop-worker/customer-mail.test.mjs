import assert from "node:assert/strict";
import test from "node:test";
import {
  SELLER,
  formatOrderConfirmation,
  mailTransportReady,
  normalizeEmail,
  sendMail,
  sendOrderConfirmation,
} from "./customer-mail.js";

const ORDER = {
  id: "order-1",
  order_number: "D119-20260923-ABC12345",
  status: "PAID",
  currency: "EUR",
  subtotal_cents: 38000,
  shipping_cents: 590,
  total_cents: 38590,
  created_at: "2026-09-23T08:15:00.000Z",
  items: [
    { article_no: "119-42", title_snapshot: "Prada Reversible Jacket", unit_price_cents: 38000 },
  ],
  contact: {
    email: "kundin@example.com",
    recipient_name: "A. Beispiel",
    address_line1: "Musterweg 3",
    postal_code: "63739",
    city: "Aschaffenburg",
    country_code: "DE",
  },
};

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

function confirmationDb({ claimed = true, order = ORDER } = {}) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      const text = String(sql);
      return {
        bind(...args) {
          return {
            async first() {
              if (text.includes("FROM commerce_orders")) {
                const { items, contact, ...rest } = order;
                return rest;
              }
              if (text.includes("FROM order_contact_snapshots")) return order.contact || null;
              return null;
            },
            async all() {
              if (text.includes("FROM order_items")) return { results: order.items || [] };
              return { results: [] };
            },
            async run() {
              writes.push({ text, args });
              if (text.includes("INSERT OR IGNORE INTO audit_events")) {
                return { meta: { changes: claimed ? 1 : 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

const READY_ENV = {
  MAIL_API_KEY: "test-key",
  MAIL_FROM: "bestellung@disorder119.com",
  MAIL_FROM_NAME: "DISORDER119",
};

test("mail transport needs both key and sender", () => {
  assert.equal(mailTransportReady({}), false);
  assert.equal(mailTransportReady({ MAIL_API_KEY: "k" }), false);
  assert.equal(mailTransportReady({ MAIL_FROM: "a@b.de" }), false);
  assert.equal(mailTransportReady(READY_ENV), true);
});

test("addresses are validated before anything is sent", () => {
  assert.equal(normalizeEmail("Kundin@Example.COM "), "kundin@example.com");
  assert.equal(normalizeEmail("keine-adresse"), "");
  assert.equal(normalizeEmail("a@b"), "");
  assert.equal(normalizeEmail("zwei@ adressen.de"), "");
  assert.equal(normalizeEmail(null), "");
});

test("order confirmation carries every legally required part", () => {
  const mail = formatOrderConfirmation(ORDER, { contactEmail: "bestellung@disorder119.com" });
  for (const part of [mail.text, mail.html]) {
    assert.match(part, /D119-20260923-ABC12345/);
    assert.match(part, /Prada Reversible Jacket/);
    assert.match(part, /119-42/);
    assert.match(part, /23\.09\.2026/);
    // Warenwert, Versand und Gesamt muessen einzeln nachvollziehbar sein.
    assert.match(part, /380,00/);
    assert.match(part, /5,90/);
    assert.match(part, /385,90/);
    assert.match(part, /§ 19 UStG/);
    assert.match(part, /Widerrufsrecht/);
    assert.match(part, /Muster-Widerrufsformular/);
    assert.match(part, new RegExp(SELLER.street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(part, /Musterweg 3/);
  }
  assert.match(mail.subject, /D119-20260923-ABC12345/);
});

test("hostile item titles cannot inject markup into the mail", () => {
  const mail = formatOrderConfirmation({
    ...ORDER,
    items: [{ title_snapshot: '<script>alert("x")</script>', unit_price_cents: 100 }],
  }, { contactEmail: "bestellung@disorder119.com" });
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /&lt;script&gt;/);
});

test("sending refuses unconfigured transport and broken addresses", async () => {
  assert.deepEqual(await sendMail({}, { to: "a@b.de", subject: "x" }), { sent: false, reason: "NOT_CONFIGURED" });
  assert.deepEqual(
    await sendMail(READY_ENV, { to: "kaputt", subject: "x" }),
    { sent: false, reason: "INVALID_RECIPIENT" },
  );
  assert.deepEqual(
    await sendMail(READY_ENV, { to: "a@b.de", subject: "" }),
    { sent: false, reason: "EMPTY_SUBJECT" },
  );
});

test("sending posts key, sender and recipient to the provider", async () => {
  const stub = stubFetch(async () => new Response(JSON.stringify({ messageId: "<abc@brevo>" }), { status: 201 }));
  try {
    const result = await sendMail(READY_ENV, {
      to: "kundin@example.com",
      subject: "Test",
      text: "Hallo",
      tag: "order-confirmation",
    });
    assert.equal(result.sent, true);
    assert.equal(result.messageId, "<abc@brevo>");
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0].url, /api\.brevo\.com/);
    assert.equal(stub.calls[0].init.headers["api-key"], "test-key");
    const body = JSON.parse(stub.calls[0].init.body);
    assert.equal(body.sender.email, "bestellung@disorder119.com");
    assert.equal(body.to[0].email, "kundin@example.com");
    assert.deepEqual(body.tags, ["order-confirmation"]);
  } finally {
    stub.restore();
  }
});

test("a provider error never leaks the customer address into the message", async () => {
  const stub = stubFetch(async () => new Response(
    JSON.stringify({ code: "invalid_parameter", message: "recipient kundin@example.com rejected" }),
    { status: 400 },
  ));
  try {
    await assert.rejects(
      () => sendMail(READY_ENV, { to: "kundin@example.com", subject: "Test", text: "x" }),
      err => {
        assert.match(err.message, /^mail_api_error:/);
        return true;
      },
    );
  } finally {
    stub.restore();
  }
});

test("order confirmation is sent once and claimed in the audit trail", async () => {
  const db = confirmationDb();
  const stub = stubFetch(async () => new Response(JSON.stringify({ messageId: "<one@brevo>" }), { status: 201 }));
  try {
    const result = await sendOrderConfirmation({ ...READY_ENV, DB: db }, "order-1", "req-1");
    assert.deepEqual(result, { sent: true, recorded: true });
    assert.equal(stub.calls.length, 1);
    assert.ok(db.writes.some(w => w.text.includes("INSERT OR IGNORE INTO audit_events")));
    assert.ok(db.writes.some(w => w.text.includes("ORDER_CONFIRMATION_SENT")));
  } finally {
    stub.restore();
  }
});

test("a second delivery attempt for the same order is refused", async () => {
  const db = confirmationDb({ claimed: false });
  const stub = stubFetch(async () => { throw new Error("must not send twice"); });
  try {
    const result = await sendOrderConfirmation({ ...READY_ENV, DB: db }, "order-1", "req-2");
    assert.deepEqual(result, { sent: false, duplicate: true });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("an order without a captured address reports instead of guessing", async () => {
  const db = confirmationDb({ order: { ...ORDER, contact: {} } });
  const result = await sendOrderConfirmation({ ...READY_ENV, DB: db }, "order-1", "req-3");
  assert.deepEqual(result, { sent: false, reason: "NO_CUSTOMER_EMAIL" });
});

test("an unpaid order is never confirmed", async () => {
  const db = confirmationDb({ order: { ...ORDER, status: "PAYMENT_PENDING" } });
  const result = await sendOrderConfirmation({ ...READY_ENV, DB: db }, "order-1", "req-4");
  assert.deepEqual(result, { sent: false, reason: "ORDER_NOT_PAID" });
});

test("a failed send releases the claim so a retry can still reach the customer", async () => {
  const db = confirmationDb();
  const stub = stubFetch(async () => new Response(JSON.stringify({ message: "upstream down" }), { status: 502 }));
  try {
    await assert.rejects(
      () => sendOrderConfirmation({ ...READY_ENV, DB: db }, "order-1", "req-5"),
      /order_confirmation_failed/,
    );
    assert.ok(db.writes.some(w => w.text.includes("DELETE FROM audit_events")));
  } finally {
    stub.restore();
  }
});
