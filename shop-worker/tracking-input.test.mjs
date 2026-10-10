import test from "node:test";
import assert from "node:assert/strict";
import { parseTrackingInput, trackingUrlFor } from "./tracking-input.js";

function rejects(value, code) {
  assert.throws(() => parseTrackingInput(value), error => error.code === code, String(value));
}

test("plain and formatted IDs remain canonical without guessing a carrier", () => {
  assert.deepEqual(parseTrackingInput(" 0034 0412 3456 7890 "), { trackingNumber: "0034041234567890", carrier: "", platform: "" });
  assert.deepEqual(parseTrackingInput(" ab123456789de "), { trackingNumber: "AB123456789DE", carrier: "", platform: "" });
  assert.equal(parseTrackingInput("AB12").trackingNumber, "AB12");
  assert.equal(parseTrackingInput("1z999aa10123456784").carrier, "UPS");
  assert.equal(parseTrackingInput("1Z123456").carrier, "");
});

test("recognises only explicit tracking text and Vinted context", () => {
  assert.deepEqual(parseTrackingInput("Deine Vinted-Bestellung ist unterwegs.\nSendungsnummer: ab123456789de"), { trackingNumber: "AB123456789DE", carrier: "", platform: "Vinted" });
  assert.equal(parseTrackingInput("Tracking number: 123456789 Please track the package.").trackingNumber, "123456789");
  assert.equal(parseTrackingInput("Sendungsnummer: 0034\t0412 3456 7890").trackingNumber, "0034041234567890");
  assert.equal(parseTrackingInput("Tracking number: 1Z 999 AA 10 1234 5678 4").trackingNumber, "1Z999AA10123456784");
});

const links = [
  ["https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=0034041234567890", "0034041234567890", "DHL"],
  ["https://www.dhl.com/tracking?trackingNumber=ab123456789de", "AB123456789DE", "DHL"],
  ["https://www.myhermes.de/empfangen/sendungsverfolgung/?TrackID=12345678901234", "12345678901234", "Hermes"],
  ["https://www.dpd.com/de/de/empfangen/sendungsverfolgung/?parcelNumber=12345678901234", "12345678901234", "DPD"],
  ["https://tracking.dpd.de/track?parcelno=12345678901234", "12345678901234", "DPD"],
  ["https://tracking.dpd.de/status/de_DE/parcel/12345678901234", "12345678901234", "DPD"],
  ["https://gls-group.com/DE/de/paketverfolgung?match=AB123456", "AB123456", "GLS"],
  ["https://www.ups.com/track?tracknum=1z999aa10123456784", "1Z999AA10123456784", "UPS"],
  ["https://www.fedex.com/fedextrack/?trknbr=123456789012", "123456789012", "FedEx"],
  ["https://t.17track.net/de#nums=ab123456789de", "AB123456789DE", ""],
  ["https://www.17track.net/en?nums=AB123456789DE", "AB123456789DE", ""],
  ["https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901", "6A12345678901", "La Poste"],
  ["https://www.chronopost.fr/fr/chrono_suivi_search?listeNumerosLT=XY123456789FR", "XY123456789FR", "Chronopost"],
  ["https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=12345678", "12345678", "Mondial Relay"],
  ["https://www.mondialrelay.fr/suivi-de-colis?expedition=12345678", "12345678", "Mondial Relay"]
];

test("extracts carrier-specific official links and their decoded parameters", () => {
  for (const [url, number, carrier] of links) {
    assert.deepEqual(parseTrackingInput(url), { trackingNumber: number, carrier, platform: "" }, url);
    assert.deepEqual(parseTrackingInput("Vinted: Dein Paket ist unterwegs (" + url + ")."), { trackingNumber: number, carrier, platform: "Vinted" }, url);
    assert.equal(parseTrackingInput("Tracking number: " + url).trackingNumber, number);
  }
  assert.equal(parseTrackingInput("https://www.dhl.de/tracking?PIECECODE=0034%200412%203456%207890").trackingNumber, "0034041234567890");
});

test("does not turn order IDs, arbitrary paths or unsafe links into tracking numbers", () => {
  for (const input of [
    "https://www.vinted.de/items/123456789", "https://www.vinted.de/orders/123456789", "https://www.vinted.de/inbox/123456789",
    "https://vinted.fr/conversations/123456789", "https://www.dhl.de/123456789", "https://tracking.dpd.de/orders/123456789",
    "https://example.com/?piececode=123456789", "https://www.dhl.de.evil.example/?piececode=123456789",
    "https://www.dhl.de@evil.example/?piececode=123456789", "https://evil.example@www.dhl.de/?piececode=123456789",
    "https://www.dhl.de:8443/?piececode=123456789", "javascript:alert(123456789)", "data:text/plain,123456789",
    "//www.dhl.de/?piececode=123456789", "https:/www.dhl.de/?piececode=123456789",
    "Tracking number: 123456789 https://evil.example/123456789"
  ]) rejects(input, "TRACKING_INPUT_UNSUPPORTED");
  for (const input of ["", null, {}, "123", "AB_123456", "123456/foo", "A".repeat(41), "Sendungsnummer: 123456/foo", "Tracking number: 123456.789", "Sendungsnummer: 123456?foo=bar", "12345\u0000"]) {
    rejects(input, "TRACKING_NUMBER_INVALID");
  }
});

test("rejects ambiguous multi-number input instead of tracking the wrong order", () => {
  for (const input of [
    "123456789,987654321", "123456789\n987654321", "123456789 987654321",
    "Sendungsnummer:123456789,987654321", "Tracking number:123456789\n987654321",
    "Sendungsnummer: 123456789\nTracking number: 987654321",
    "https://t.17track.net/de#nums=123456789,987654321", "https://t.17track.net/de#nums=123456789%2C987654321",
    "https://www.dhl.de/?piececode=123456789&piececode=987654321",
    "https://www.dhl.de/?piececode=123456789\nhttps://www.dpd.de/?parcelno=987654321"
  ]) rejects(input, "TRACKING_INPUT_AMBIGUOUS");
  assert.equal(parseTrackingInput("https://www.dhl.de/?piececode=123456789\nSendungsnummer: 123456789").trackingNumber, "123456789");
});

test("builds official HTTPS links that round-trip and drops arbitrary stored URLs", () => {
  for (const [, number, carrier] of links) {
    const canonical = trackingUrlFor(number, carrier);
    assert.equal(new URL(canonical).protocol, "https:");
    assert.equal(parseTrackingInput(canonical).trackingNumber, number);
    if (carrier) assert.equal(parseTrackingInput(canonical).carrier, carrier);
  }
  assert.equal(trackingUrlFor(" ab123456789de ", "Unknown"), "https://t.17track.net/de#nums=AB123456789DE");
  assert.equal(trackingUrlFor("123456789", "https://evil.example"), "https://t.17track.net/de#nums=123456789");
  assert.throws(() => trackingUrlFor("https://evil.example/123456789", "DHL"), error => error.code === "TRACKING_NUMBER_INVALID");
});
