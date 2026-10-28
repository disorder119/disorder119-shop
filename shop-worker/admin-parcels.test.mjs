import test from "node:test";
import assert from "node:assert/strict";
import { parcelCounts, parseTrack17 } from "./admin-parcels.js";

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
  ];
  const counts = parcelCounts(parcels, new Date("2026-10-02T12:00:00+02:00"));
  assert.deepEqual(counts, { total:4, today:1, transit:2, incoming:1, outgoing:2, problems:1, done:1 });
});
