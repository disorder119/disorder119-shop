import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";

function seed() {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  const orders = [["o1", "D119-1", "PAID", 6241], ["o2", "D119-2", "PREPARING", 6242], ["o3", "D119-3", "SHIPPED", 6243]];
  for (const [id, number, status, itemId] of orders) {
    run(`INSERT INTO inventory (id,item_id,status,sale_price_cents,updated_at) VALUES (?,?,?,9000,?)`, `i-${id}`, itemId, status, now);
    run(`INSERT INTO commerce_orders (id,order_number,status,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES (?,?,?,9000,590,9590,?,?)`, id, number, status, `k-${id}`, now);
    run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,title_snapshot,unit_price_cents) VALUES (?,?,?,?,?,9000)`,
      `oi-${id}`, id, `i-${id}`, itemId, `Stück ${itemId}`);
  }
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,given_name,surname,city,captured_at)
    VALUES ('o1','PAYPAL','Maria','Muster','Aschaffenburg',?)`, now);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,recipient_name,city,captured_at)
    VALUES ('o2','PAYPAL','Lena Beispiel','Berlin',?)`, now);
  return DB;
}

async function list(DB, status) {
  const url = `https://api.disorder119.com/admin/orders${status ? `?status=${status}` : ""}`;
  const req = new Request(url, { headers: { Authorization: "Bearer t", Origin: ADMIN } });
  const res = await handleAdminRequest(req, { DB, ADMIN_TOKEN: "t" }, new URL(url), "req", ADMIN);
  return { status: res.status, data: await res.json() };
}

test("the order list carries item ids and the customer's name for the admin app", async () => {
  const DB = seed();
  const offen = await list(DB, "PAID,PREPARING");
  assert.equal(offen.status, 200);
  assert.deepEqual(
    offen.data.orders.map(o => [o.order_number, o.itemIds, o.customerName, o.customerCity]).sort(),
    [["D119-1", "6241", "Maria Muster", "Aschaffenburg"], ["D119-2", "6242", "Lena Beispiel", "Berlin"]],
  );
  assert.equal(offen.data.total, 2);
  assert.equal((await list(DB, "SHIPPED")).data.total, 1);
  assert.equal((await list(DB)).data.total, 3);
  const bad = await list(DB, "PAID,HACKED");
  assert.equal(bad.status, 400);
});

test("Bestellbild, DHL-Stand und Uebersicht kommen vom Server (Inhaber 06.11.2026)", async () => {
  const { oeffentlichenKatalogLeeren } = await import("./oeffentlicher-katalog.js");
  const original = globalThis.fetch;
  const katalog = [
    { id: 6241, public_status: "AVAILABLE", price: 90, grid_image: "assets/img/6241/thumbs/0.webp", gallery: ["assets/img/6241/0.webp"] },
    { id: 6242, public_status: "SOLD", price: 0, gallery: ["assets/img/6242/0.webp"] },
    { id: 6243, public_status: "AVAILABLE", price: 0, gallery: [] },
  ];
  globalThis.fetch = async url => String(url).includes("catalog.json")
    ? new Response(JSON.stringify(katalog), { headers: { "Content-Type": "application/json" } })
    : new Response("nein", { status: 404 });
  oeffentlichenKatalogLeeren();
  try {
    const DB = seed();
    const now = new Date().toISOString();
    DB.raw.prepare(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at) VALUES ('s3','o3','DHL','Online-Frankierung','00340434161234567890','SHIPPED',?)`).run(now);
    DB.raw.prepare(`INSERT INTO sendungs_abfragen (shipment_id,tracking_number,zustand,abfragen,zuletzt_am,fehler,ereignisse_json)
      VALUES ('s3','00340434161234567890','UNBEKANNT',13,?,'HTTP_401',?)`).run(now, JSON.stringify([{ zeit: now, text: "Die Sendung wurde abgeholt.", ort: "Aschaffenburg" }]));

    const liste = await list(DB);
    const bild = Object.fromEntries(liste.data.orders.map(o => [o.order_number, o.itemImage]));
    assert.equal(bild["D119-1"], "/assets/img/6241/thumbs/0.webp", "Vorschaubild wie im Shop");
    assert.equal(bild["D119-2"], "/assets/img/6242/0.webp", "ohne Vorschaubild das erste Foto");
    assert.equal(bild["D119-3"], null);

    const detailUrl = "https://api.disorder119.com/admin/orders/o3";
    const res = await handleAdminRequest(new Request(detailUrl, { headers: { Authorization: "Bearer t", Origin: ADMIN } }), { DB, ADMIN_TOKEN: "t" }, new URL(detailUrl), "req", ADMIN);
    const detail = await res.json();
    assert.equal(res.status, 200);
    const s = detail.shipments[0];
    assert.equal(s.tracking_number, "00340434161234567890", "Sendungsnummer bleibt die der Sendung");
    assert.equal(s.dhlLink, "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161234567890");
    assert.equal(s.verfolgung.fehler, "HTTP_401");
    assert.equal(s.verfolgung.abfragen, 13);
    assert.equal(s.verfolgung.stationen[0].ort, "Aschaffenburg");
    assert.ok(!("verfolgung_fehler" in s), "keine Rohspalten");

    const ueUrl = "https://api.disorder119.com/admin/overview?days=30";
    const ue = await (await handleAdminRequest(new Request(ueUrl, { headers: { Authorization: "Bearer t", Origin: ADMIN } }), { DB, ADMIN_TOKEN: "t" }, new URL(ueUrl), "req", ADMIN)).json();
    assert.deepEqual(ue.katalog, { online: 1, verkauft: 1 }, "online = verfuegbar mit Preis");
    assert.equal(ue.zeitraum.bestellungen, 3);
    DB.raw.prepare("UPDATE commerce_orders SET versteckt=1 WHERE id='o1'").run();
    const ue2 = await (await handleAdminRequest(new Request(ueUrl, { headers: { Authorization: "Bearer t", Origin: ADMIN } }), { DB, ADMIN_TOKEN: "t" }, new URL(ueUrl), "req", ADMIN)).json();
    assert.equal(ue2.zeitraum.bestellungen, 2, "ausgeblendete Testbestellung zaehlt nicht");
  } finally {
    globalThis.fetch = original;
    oeffentlichenKatalogLeeren();
  }
});
