import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleAdminParcels, parcelCounts, parseTrack17, refreshManualParcels } from "./admin-parcels.js";

function setup(t, rows = [], { enabled = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("./migrations/0038_parcel_tracker.sql", import.meta.url), "utf8"));
  sqlite.exec(`CREATE TABLE shipments (id TEXT, order_id TEXT, tracking_number TEXT, carrier TEXT, service TEXT, status TEXT, delivered_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE commerce_orders (id TEXT, order_number TEXT, status TEXT);
    CREATE TABLE order_items (order_id TEXT, title_snapshot TEXT);`);
  for (let i = 0; i < rows.length; i++) {
    const row = {
      id:`parcel-${i}`, tracking_number:`ABCD${i}`, status:"IN_TRANSIT", track17_registered:1,
      track17_expired:0, direction:"IN", carrier:"DHL", created_at:"2026-10-01T08:00:00.000Z",
      updated_at:"2026-10-01T08:00:00.000Z", ...rows[i],
    };
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT INTO parcel_tracker_manual (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  }
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args) || null; },
        async all() { return { results:statement.all(...args) }; },
        async run() { const result = statement.run(...args); return { meta:{ changes:Number(result.changes) } }; },
      };
    },
  };
  const env = { ADMIN_TOKEN:"test-admin-token", DB, ...(enabled ? { TRACK17_API_KEY:"test-provider-key" } : {}) };
  return {
    sqlite,
    async request(path, method = "GET", body) {
      const url = new URL(path, "https://api.disorder119.com");
      const request = new Request(url, {
        method,
        headers:{ Authorization:"Bearer test-admin-token", "Content-Type":"application/json" },
        ...(body === undefined ? {} : { body:JSON.stringify(body) }),
      });
      const response = await handleAdminParcels(request, env, url, "test-request", "https://admin.disorder119.com");
      return { status:response.status, data:await response.json() };
    },
  };
}

function providerResponse(accepted = [], rejected = []) {
  return Response.json({ code:0, data:{ accepted, rejected } });
}

function trackItem(number, status = "InTransit") {
  return { number, carrier:100003, track_info:{ latest_status:{ status }, latest_event:{ time_iso:"2026-10-10T09:00:00Z", description:"Im Paketzentrum", location:"Berlin" } } };
}

test("17TRACK parser ignores address data and maps delivery status", () => {
  const parsed = parseTrack17({
    number: "1234",
    carrier: 100003,
    shipping_info: { shipper_address: "must never be used" },
    track_info: {
      latest_status: { status: "OutForDelivery" },
      latest_event: { time_iso: "2026-10-02T08:00:00+02:00", description: "Out for delivery", location: "Aschaffenburg", address: "private" },
      tracking: { providers: [{ events: [{ time_iso: "2026-10-02T08:00:00+02:00", description: "Out for delivery", location: "Aschaffenburg", address: "private" }] }] },
      time_metrics: { estimated_delivery_date: { from: "2026-10-02T10:00:00+02:00", to: "2026-10-02T14:00:00+02:00" } },
    },
  });
  assert.equal(parsed.status, "OUT_FOR_DELIVERY");
  assert.equal(parsed.location, "Aschaffenburg");
  assert.equal(parsed.events[0].text, "Out for delivery");
  assert.equal(JSON.stringify(parsed).includes("private"), false);
});

test("parcel counters distinguish direction, today and problems", () => {
  const parcels = [
    { status:"OUT_FOR_DELIVERY", direction:"IN", etaDate:"2026-10-02" },
    { status:"IN_TRANSIT", direction:"OUT", etaDate:null },
    { status:"EXCEPTION", direction:"RETURN", etaDate:null },
    { status:"DELIVERED", direction:"IN", etaDate:null },
    { status:"PICKUP_READY", direction:"IN", etaDate:null },
  ];
  const counts = parcelCounts(parcels, new Date("2026-10-02T12:00:00+02:00"));
  assert.deepEqual(counts, { total:5, today:2, transit:3, incoming:2, outgoing:2, problems:1, done:1 });
});

test("list renders saved parcels and tracking availability without provider calls", async t => {
  const app = setup(t, [{ tracking_number:"00340434123456789012" }]);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Provider must not be queried on load"); });
  const result = await app.request("/admin/parcels");
  assert.equal(result.status, 200);
  assert.equal(result.data.trackingEnabled, true);
  assert.equal(result.data.parcels.length, 1);
  assert.equal(new URL(result.data.parcels[0].trackingUrl).hostname.endsWith("dhl.de"), true);
  const offline = setup(t, [], { enabled:false });
  assert.equal((await offline.request("/admin/parcels")).data.trackingEnabled, false);
});

test("legacy punctuation in a saved number does not break the whole parcel list", async t => {
  const app = setup(t, [{ tracking_number:"ABCD/1234" }]);
  const result = await app.request("/admin/parcels");
  assert.equal(result.status, 200);
  assert.equal(result.data.parcels[0].trackingNumber, "ABCD/1234");
  assert.equal(result.data.parcels[0].trackingUrl, "https://t.17track.net/de#nums=ABCD%2F1234");
});

test("create accepts tracking links, normalizes numbers and respects user metadata", async t => {
  const app = setup(t);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Saving must stay local"); });
  const result = await app.request("/admin/parcels", "POST", {
    trackingInput:"https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=00340434123456789012",
    label:"Vintage Jacke", platform:"Vinted", carrier:"DHL Paket",
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.parcel.trackingNumber, "00340434123456789012");
  assert.equal(result.data.parcel.platform, "Vinted");
  assert.equal(result.data.parcel.carrier, "DHL Paket");
  assert.equal(result.data.parcel.track17.registered, false);
  const raw = await app.request("/admin/parcels", "POST", { trackingNumber:"rr123456789de" });
  assert.equal(raw.status, 201);
  assert.equal(raw.data.parcel.trackingNumber, "RR123456789DE");
});

test("existing lowercase numbers are detected as duplicates after pasting", async t => {
  const app = setup(t, [{ tracking_number:"rr123456789de" }]);
  const result = await app.request("/admin/parcels", "POST", { trackingNumber:"RR123456789DE" });
  assert.equal(result.status, 409);
  assert.equal(result.data.error, "TRACKING_NUMBER_EXISTS");
  assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM parcel_tracker_manual").get().n, 1);
});

test("unsupported tracking links are rejected without fetching their destination", async t => {
  const app = setup(t);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Pasted URLs must never be fetched"); });
  const result = await app.request("/admin/parcels", "POST", { trackingInput:"https://example.com/order/123456789" });
  assert.equal(result.status, 400);
  assert.equal(result.data.error, "TRACKING_INPUT_UNSUPPORTED");
});

test("registration sends only one request and retries do not consume quota", async t => {
  const app = setup(t, [{ track17_registered:0 }]);
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    calls.push({ url, payload:JSON.parse(options.body) });
    return Promise.resolve(providerResponse([{ number:"ABCD0", carrier:100003 }]));
  });
  const result = await app.request("/admin/parcels/parcel-0/17track/register", "POST", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.trackingEnabled, true);
  assert.equal(result.data.parcel.track17.registered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith("/register"), true);
  assert.deepEqual(calls[0].payload, [{ number:"ABCD0" }]);
  const retry = await app.request("/admin/parcels/parcel-0/17track/register", "POST", {});
  assert.equal(retry.data.alreadyRegistered, true);
  assert.equal(calls.length, 1);
});

test("provider failures and missing data preserve cached status and expose error codes", async t => {
  const app = setup(t, [{ status_text:"Zuletzt im Paketzentrum", track17_events_json:'[{"text":"Unterwegs"}]' }]);
  t.mock.method(globalThis, "fetch", () => Promise.resolve(new Response("busy", { status:429 })));
  const failed = await app.request("/admin/parcels/parcel-0/refresh", "POST", {});
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.data.errorCodes, ["TRACK17_RATE_LIMIT"]);
  assert.equal(failed.data.errors, 1);
  assert.equal(failed.data.parcel.status, "IN_TRANSIT");
  assert.equal(failed.data.parcel.statusText, "Zuletzt im Paketzentrum");
  t.mock.method(globalThis, "fetch", () => Promise.resolve(providerResponse([trackItem("ABCD0", "NotFound")])));
  const missing = await app.request("/admin/parcels/parcel-0/refresh", "POST", {});
  assert.deepEqual(missing.data.errorCodes, ["TRACK17_NO_DATA"]);
  assert.equal(missing.data.parcel.events[0].text, "Unterwegs");
});

test("batch refresh skips recently synced parcels while a single refresh is forced", async t => {
  const app = setup(t, [
    { track17_last_sync:new Date().toISOString() },
    { id:"done", tracking_number:"DONE1", status:"DELIVERED", track17_expired:1 },
    { id:"unregistered", tracking_number:"NEVER1", track17_registered:0 },
  ]);
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push(payload);
    return Promise.resolve(providerResponse(payload.map(row => trackItem(row.number, row.number === "DONE1" ? "Delivered" : "InTransit"))));
  });
  const batch = await app.request("/admin/parcels/refresh", "POST", {});
  assert.deepEqual(batch.data, { refreshed:0, errors:0, skipped:1, errorCodes:[] });
  assert.equal(calls.length, 0);
  assert.equal((await app.request("/admin/parcels/parcel-0/refresh", "POST", {})).data.refreshed, 1);
  const done = await app.request("/admin/parcels/done/refresh", "POST", {});
  assert.equal(done.data.refreshed, 1);
  assert.equal(done.data.parcel.status, "DELIVERED");
  assert.equal(done.data.parcel.track17.expired, false);
  assert.equal(calls.length, 2);
  assert.equal((await app.request("/admin/parcels/unregistered/refresh", "POST", {})).status, 409);
  assert.equal(calls.length, 2);
});

test("batch is bounded to 40 oldest parcels and reports partial rejections", async t => {
  const rows = Array.from({ length:42 }, (_, i) => ({ track17_last_sync:new Date(Date.now() - (i + 1) * 3600000).toISOString() }));
  const app = setup(t, rows);
  let payload;
  t.mock.method(globalThis, "fetch", (_, options) => {
    payload = JSON.parse(options.body);
    return Promise.resolve(providerResponse(payload.slice(1).map(row => trackItem(row.number)), [{ number:payload[0].number, error:{ code:-18019909 } }]));
  });
  const result = await app.request("/admin/parcels/refresh", "POST", {});
  assert.equal(payload.length, 40);
  assert.equal(payload[0].number, "ABCD41");
  assert.equal(result.data.refreshed, 39);
  assert.equal(result.data.errors, 1);
  assert.equal(result.data.skipped, 2);
  assert.deepEqual(result.data.errorCodes, ["TRACK17_BATCH_LIMIT", "TRACK17_NO_DATA"]);
});

test("manual edits made during a provider request win over its stale response", async t => {
  const app = setup(t, [{}]);
  t.mock.method(globalThis, "fetch", () => {
    app.sqlite.prepare("UPDATE parcel_tracker_manual SET status='DELIVERED',updated_at=? WHERE id='parcel-0'").run(new Date().toISOString());
    return Promise.resolve(providerResponse([trackItem("ABCD0")]));
  });
  const result = await app.request("/admin/parcels/parcel-0/refresh", "POST", {});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.refreshed, 0);
  assert.equal(result.data.skipped, 1);
  assert.deepEqual(result.data.errorCodes, ["PARCEL_CHANGED_DURING_REFRESH"]);
  assert.equal(result.data.parcel.status, "DELIVERED");
});

test("an expired provider record stops auto sync without erasing the last known history", async t => {
  const app = setup(t, [{ status_text:"Abholbereit", status:"PICKUP_READY", track17_events_json:'[{"text":"Im Paketshop"}]' }]);
  t.mock.method(globalThis, "fetch", () => Promise.resolve(providerResponse([trackItem("ABCD0", "Expired")])));
  const result = await app.request("/admin/parcels/parcel-0/refresh", "POST", {});
  assert.equal(result.data.refreshed, 1);
  assert.equal(result.data.parcel.status, "PICKUP_READY");
  assert.equal(result.data.parcel.statusText, "Abholbereit");
  assert.equal(result.data.parcel.events[0].text, "Im Paketshop");
  assert.equal(result.data.parcel.track17.expired, true);
  const batch = await app.request("/admin/parcels/refresh", "POST", {});
  assert.equal(batch.data.refreshed, 0);
});

test("deadline includes a stalled response body and returns timeout instead of hanging", async t => {
  const app = setup(t, [{ track17_registered:0 }]);
  t.mock.timers.enable({ apis:["setTimeout"] });
  let bodyStarted;
  const reading = new Promise(resolve => { bodyStarted = resolve; });
  t.mock.method(globalThis, "fetch", () => Promise.resolve({
    status:200, ok:true,
    json() { bodyStarted(); return new Promise(() => {}); },
  }));
  const pending = app.request("/admin/parcels/parcel-0/17track/register", "POST", {});
  await reading;
  t.mock.timers.tick(8000);
  const result = await pending;
  assert.equal(result.status, 504);
  assert.equal(result.data.error, "TRACK17_TIMEOUT");
  assert.equal(app.sqlite.prepare("SELECT track17_registered FROM parcel_tracker_manual").get().track17_registered, 0);
});

test("scheduled refresh is safe before configuration or migration and never registers parcels", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Not configured, no provider calls allowed"); });
  assert.deepEqual(await refreshManualParcels({ DB:{ prepare() { throw new Error("Should not query without provider key"); } } }), {
    refreshed:0, errors:0, skipped:0, errorCodes:["TRACK17_NOT_CONFIGURED"],
  });
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const noSchema = await refreshManualParcels({ TRACK17_API_KEY:"test-provider-key", DB:{ prepare(sql) { return sqlite.prepare(sql); } } });
  assert.deepEqual(noSchema.errorCodes, ["PARCEL_TRACKER_NOT_READY"]);
  const app = setup(t, [{ track17_registered:0 }]);
  assert.deepEqual((await app.request("/admin/parcels/refresh", "POST", {})).data, { refreshed:0, errors:0, skipped:0, errorCodes:[] });
});

