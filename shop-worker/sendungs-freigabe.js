// Verdrahtung der DHL-Sendungsverfolgung (dhl-tracking.sendungenVerfolgen) mit
// Bestellstatus und Telegram-Freigaben (Inhaber 14.11.2026):
//
//   * Der Bestellstatus laeuft wie bisher (SHIPPED mit Zahlungseinzug,
//     DELIVERED) - aber die Versandmail geht beim Wechsel auf SHIPPED NICHT
//     mehr von selbst raus.
//   * Fuer "unterwegs", "abholbereit" und "zugestellt" bekommt der Inhaber je
//     Sendung eine Telegram-Nachricht mit Vorschau der Kundenmail. Erst sein
//     Klick auf "Kundenmail senden" verschickt sie (telegram-pickup.js).
//
// Testshop: Der Telegram-Webhook gehoert dem echten Server, eine Freigabe
// koennte dort nie bestaetigt werden. Deshalb bleibt es im Testshop beim
// bisherigen Ablauf (Versandmail sofort - sie geht dort ohnehin nur an das
// eigene Postfach), ohne Freigaben fuer "unterwegs" und "zugestellt".
import { orderStatusAutomatisch } from "./admin-api.js";
import { notifyStatusFreigabe } from "./notifications.js";
import { istSandbox } from "./sandbox.js";

export function sendungsVerdrahtung(env, reqId) {
  const testshop = istSandbox(env);
  return {
    statusSetzen: (orderId, status) => orderStatusAutomatisch(env, orderId, status, reqId, { versandmail: testshop }),
    abholbereitMelden: (sendung, stand) => notifyStatusFreigabe(env, "ABHOLBEREIT", sendung, stand, reqId),
    ...(testshop ? {} : {
      versendetMelden: (sendung, stand) => notifyStatusFreigabe(env, "VERSENDET", sendung, stand, reqId),
      zugestelltMelden: (sendung, stand) => notifyStatusFreigabe(env, "ZUGESTELLT", sendung, stand, reqId),
    }),
  };
}
