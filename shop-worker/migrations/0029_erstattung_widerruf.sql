-- Storno, Ruecksendung und Widerruf "wasserfest".
--
-- erstattungsauftraege: Eine Erstattung, die der Inhaber ausloest (Storno vor
-- dem Versand, Ruecksendung, Widerruf, Kulanz), bleibt als Auftrag bestehen,
-- bis PayPal sie wirklich ausgefuehrt hat. Fehlt Guthaben, wiederholt der Cron
-- den Versuch; erst danach gehen Kundenmail und "wieder im Shop" raus.
--
-- widerrufe: jede Widerrufserklaerung ueber die Widerrufsfunktion der Website
-- (§ 356a BGB), aus dem Kundenkonto oder vom Inhaber erfasst (Mail, Brief).
-- Inhalt und Eingangszeitpunkt sind Belege und unveraenderlich.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erstattungsauftraege (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  anlass TEXT NOT NULL CHECK (anlass IN ('STORNO','RUECKSENDUNG','WIDERRUF','KULANZ')),
  betrag_cents INTEGER NOT NULL CHECK (betrag_cents > 0),
  -- Aufschluesselung fuer die Kundenmail: erstattete Stuecke (JSON-Liste mit
  -- itemId, inventoryId, titel, preisCents), Versandanteil und ein Abzug
  -- (Wertersatz) samt Grund. betrag_cents ist massgeblich.
  artikel_json TEXT,
  versand_cents INTEGER NOT NULL DEFAULT 0 CHECK (versand_cents >= 0),
  abzug_cents INTEGER NOT NULL DEFAULT 0 CHECK (abzug_cents >= 0),
  abzug_grund TEXT,
  kunden_grund TEXT,
  -- Summe der schon abgeschlossenen Erstattungen beim Anlegen: ist die Summe
  -- spaeter um betrag_cents gewachsen (z. B. direkt in PayPal erstattet), ist
  -- der Auftrag erfuellt, ohne dass der Server noch einmal auszahlt.
  basis_erstattet_cents INTEGER NOT NULL DEFAULT 0 CHECK (basis_erstattet_cents >= 0),
  wieder_verfuegbar INTEGER NOT NULL DEFAULT 1 CHECK (wieder_verfuegbar IN (0,1)),
  -- Storno oder Widerruf, solange das Paket noch nicht unterwegs war: Ist es
  -- beim naechsten Versuch doch versendet, zahlt der Auftrag nicht blind aus.
  vor_versand INTEGER NOT NULL DEFAULT 0 CHECK (vor_versand IN (0,1)),
  widerruf_id TEXT,
  status TEXT NOT NULL DEFAULT 'OFFEN' CHECK (status IN (
    'OFFEN','IN_ARBEIT','WARTET_AUF_DECKUNG','BEI_PAYPAL','FEHLER','ERLEDIGT','ABGEBROCHEN'
  )),
  refund_id TEXT REFERENCES refunds(id),
  versuche INTEGER NOT NULL DEFAULT 0,
  letzter_versuch_at TEXT,
  naechster_versuch_at TEXT,
  letzter_fehler TEXT,
  fehler_endgueltig INTEGER NOT NULL DEFAULT 0 CHECK (fehler_endgueltig IN (0,1)),
  erstellt_von TEXT NOT NULL DEFAULT 'ADMIN' CHECK (erstellt_von IN ('ADMIN','SYSTEM')),
  kunde_benachrichtigt_at TEXT,
  kunde_mail_status TEXT CHECK (kunde_mail_status IS NULL OR kunde_mail_status IN (
    'GESENDET','KEINE_ADRESSE','NICHT_EINGERICHTET','FEHLER'
  )),
  wieder_im_shop_at TEXT,
  inhaber_gemeldet_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  erledigt_at TEXT
);
-- Hoechstens ein laufender Auftrag je Bestellung: ein zweiter Klick findet ihn.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_erstattungsauftrag_laufend
  ON erstattungsauftraege(order_id)
  WHERE status IN ('OFFEN','IN_ARBEIT','WARTET_AUF_DECKUNG','BEI_PAYPAL','FEHLER');
CREATE INDEX IF NOT EXISTS idx_erstattungsauftraege_faellig
  ON erstattungsauftraege(status, naechster_versuch_at);
CREATE INDEX IF NOT EXISTS idx_erstattungsauftraege_order
  ON erstattungsauftraege(order_id, created_at);

CREATE TABLE IF NOT EXISTS widerrufe (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES commerce_orders(id),
  bestellnummer_eingabe TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  umfang TEXT NOT NULL CHECK (umfang IN ('GANZ','TEIL')),
  teile_text TEXT,
  nachricht TEXT,
  sprache TEXT NOT NULL DEFAULT 'de',
  quelle TEXT NOT NULL DEFAULT 'WEBSITE' CHECK (quelle IN ('WEBSITE','KONTO','ADMIN')),
  eingegangen_at TEXT NOT NULL,
  bestaetigung_gesendet_at TEXT,
  bestaetigung_status TEXT CHECK (bestaetigung_status IS NULL OR bestaetigung_status IN (
    'GESENDET','FEHLER','GEDROSSELT','NICHT_EINGERICHTET','NICHT_NOETIG'
  )),
  status TEXT NOT NULL DEFAULT 'EINGEGANGEN' CHECK (status IN (
    'EINGEGANGEN','IN_BEARBEITUNG','ERLEDIGT','NICHT_ZUORDENBAR'
  )),
  notiz TEXT,
  erinnert_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_widerrufe_order ON widerrufe(order_id, eingegangen_at);
CREATE INDEX IF NOT EXISTS idx_widerrufe_status ON widerrufe(status, eingegangen_at);
CREATE INDEX IF NOT EXISTS idx_widerrufe_email ON widerrufe(email, eingegangen_at);

CREATE TRIGGER IF NOT EXISTS widerrufe_inhalt_unveraenderlich
BEFORE UPDATE OF name,email,umfang,teile_text,nachricht,bestellnummer_eingabe,sprache,quelle,eingegangen_at,created_at
ON widerrufe
WHEN NEW.name IS NOT OLD.name OR NEW.email IS NOT OLD.email OR NEW.umfang IS NOT OLD.umfang
  OR NEW.teile_text IS NOT OLD.teile_text OR NEW.nachricht IS NOT OLD.nachricht
  OR NEW.bestellnummer_eingabe IS NOT OLD.bestellnummer_eingabe OR NEW.sprache IS NOT OLD.sprache
  OR NEW.quelle IS NOT OLD.quelle OR NEW.eingegangen_at IS NOT OLD.eingegangen_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'widerruf_inhalt_unveraenderlich');
END;

CREATE TRIGGER IF NOT EXISTS widerrufe_nicht_loeschbar
BEFORE DELETE ON widerrufe
BEGIN
  SELECT RAISE(ABORT,'widerruf_muss_erhalten_bleiben');
END;

-- Eine einmal zugeordnete Bestellung bleibt zugeordnet (nur NULL -> Bestellung).
CREATE TRIGGER IF NOT EXISTS widerrufe_zuordnung_einmalig
BEFORE UPDATE OF order_id ON widerrufe
WHEN OLD.order_id IS NOT NULL AND NEW.order_id IS NOT OLD.order_id
BEGIN
  SELECT RAISE(ABORT,'widerruf_zuordnung_unveraenderlich');
END;
