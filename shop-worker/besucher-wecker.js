// Wecker fuer die Besuchs-Zusammenfassung: ein einziger Durable Object
// (SQLite-Speicher, laeuft auf dem kostenlosen Workers-Plan) haelt genau einen
// Alarm - den naechsten Zeitpunkt, an dem ein Besuch als beendet gilt.
// besucher-sitzung.js stellt ihn bei jedem neuen Besuch und bei jedem
// Abschied vor; der Alarm meldet alle faelligen Besuche und stellt sich auf
// den naechsten. Gespeichert wird hier nichts ausser dem Alarm selbst.
//
// Faellt der Wecker aus (Bindung fehlt, Fehler), melden die naechsten
// Seitenaufrufe und der Cron alle 15 Minuten die Besuche trotzdem.
import { naechsteFaelligkeit, sitzungenMelden } from "./besucher-zusammenfassung.js";

export class BesucherWecker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const ziel = Number(url.searchParams.get("t"));
    if (request.method !== "POST" || url.pathname !== "/stellen" || !Number.isFinite(ziel)) {
      return new Response(null, { status: 400 });
    }
    const zeitpunkt = Math.max(Math.round(ziel), Date.now() + 1000);
    const jetzt = await this.state.storage.getAlarm();
    if (jetzt === null || jetzt === undefined || jetzt > zeitpunkt) await this.state.storage.setAlarm(zeitpunkt);
    return new Response(null, { status: 204 });
  }

  async alarm() {
    const now = Date.now();
    await sitzungenMelden(this.env, now, { limit: 25 });
    const naechste = await naechsteFaelligkeit(this.env);
    if (naechste !== null) await this.state.storage.setAlarm(Math.max(naechste, now + 5000));
  }
}
