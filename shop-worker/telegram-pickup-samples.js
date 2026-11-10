// Einmalige, explizit angeforderte Telegram-Muster. Nur ein manuell in D1
// angelegter QUEUED-Marker startet sie; keine Kunden- oder Bestelldaten.
import { sendTelegramPhoto, formatPickupReadyMessage } from "./notifications.js";

export const SAMPLE_ID = "telegram:pickup:samples:2026-11-10";

export function pickupSamples() {
  const image = "https://disorder119.com/assets/og/6232.jpg";
  const samples = [
    {
      caption: formatPickupReadyMessage({ order_number: "TEST-1", kunde: "Mara Beispiel", titel: "Prada Sneaker" },
        { typ: "packstation", nummer: "234", ort: "Aschaffenburg" }) + "\nDHL meldet 234; eine alte Lieferadresse mit 119 wird nicht übernommen.",
      image,
    },
    {
      caption: formatPickupReadyMessage({ order_number: "TEST-2", kunde: "Lena Beispiel", titel: "Prada Sneaker" },
        { typ: "filiale", nummer: "45", ort: "Berlin" }), image,
    },
    {
      caption: formatPickupReadyMessage({ order_number: "TEST-3", kunde: "Noah Beispiel", titel: "Prada Sneaker" },
        { typ: "packstation", nummer: "", ort: "Hamburg" }) + "\nDie Stationsnummer fehlt bei DHL und wird nicht erfunden.", image,
    },
    { caption: "📦 TEST-4 · Bestellung bereits abgeholt\nDer alte Freigabe-Knopf würde jetzt keine Kundenmail mehr senden.", image },
    { caption: "📦 TEST-5 · Freigabe schon benutzt\nEin zweiter Klick verschickt keine zweite Kundenmail.", image },
  ];
  return samples.map((s, i) => ({ ...s, caption: `🧪 TESTMUSTER ${i + 1}/5 — keine echte Bestellung, keine Kundenmail\n\n${s.caption}\n\nDie echten Knöpfe sind in diesen Mustern bewusst deaktiviert.` }));
}

export async function sendQueuedPickupSamples(env, reqId = crypto.randomUUID()) {
  if (!env?.DB || !env?.TELEGRAM_BOT_TOKEN) return { skipped: true };
  const claimed = await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_SAMPLES_SENDING' WHERE id=? AND event_type='PICKUP_SAMPLES_QUEUED'").bind(SAMPLE_ID).run();
  if (!claimed?.meta?.changes) return { skipped: true };
  let sent = 0;
  try {
    for (const sample of pickupSamples()) {
      const result = await sendTelegramPhoto(env, sample.image, sample.caption, reqId);
      if (!result.sent) throw new Error(result.reason || "TELEGRAM_SAMPLE_FAILED");
      sent++;
      await env.DB.prepare("UPDATE audit_events SET metadata_json=? WHERE id=? AND event_type='PICKUP_SAMPLES_SENDING'")
        .bind(JSON.stringify({ sent }), SAMPLE_ID).run();
    }
    await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_SAMPLES_SENT',metadata_json=? WHERE id=? AND event_type='PICKUP_SAMPLES_SENDING'")
      .bind(JSON.stringify({ sent }), SAMPLE_ID).run();
    return { sent };
  } catch (err) {
    // Nicht blind wiederholen: Telegram kann eine Nachricht angenommen haben,
    // bevor ein Netzwerkfehler sichtbar wurde.
    console.error(JSON.stringify({ event: "telegram_pickup_samples_failed", requestId: reqId, sent, code: String(err?.message || "error").slice(0, 80) }));
    return { sent, error: true };
  }
}
