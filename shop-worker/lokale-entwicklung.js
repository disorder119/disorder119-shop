// Lokale Entwicklung der Admin-App (http://localhost:8765): diese Herkunft
// gilt NUR, wenn der Worker ausdruecklich mit LOKALE_ENTWICKLUNG="1" laeuft
// (z. B. `wrangler dev --var LOKALE_ENTWICKLUNG:1`). In wrangler.toml steht
// die Variable bewusst nicht - im Livebetrieb und im Testshop ist localhost
// damit nie eine erlaubte Herkunft (Passkeys, Admin-Anfragen, CORS).
export const LOKALE_ORIGINS = Object.freeze(["http://localhost:8765", "http://127.0.0.1:8765"]);

export function lokaleEntwicklung(env) {
  return String(env?.LOKALE_ENTWICKLUNG ?? "").trim() === "1";
}

export function lokalErlaubt(origin, env) {
  return Boolean(origin) && lokaleEntwicklung(env) && LOKALE_ORIGINS.includes(origin);
}
