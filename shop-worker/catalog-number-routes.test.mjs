import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ARTICLE_NUMBER_ROUTES } from "./catalog-number-routes.js";

// Die 301-Weiterleitungen alter Shop-IDs muessen genau der Konfiguration
// entsprechen (scripts/sync_catalog_number_routes.py erzeugt die Tabelle).
const config = JSON.parse(readFileSync(new URL("../config/catalog-number-links.json", import.meta.url), "utf8"));

test("Weiterleitungstabelle alter Shop-IDs entspricht config/catalog-number-links.json", () => {
  const ausgeschlossen = new Set((config.excluded_shop_ids || []).map(String));
  const erwartet = {};
  for (const l of config.links || []) {
    const id = String(l.shop_id), artikel = String(l.article);
    if (/^\d+$/.test(id) && /^\d+$/.test(artikel) && !ausgeschlossen.has(id) && id !== artikel) erwartet[id] = artikel;
  }
  assert.deepEqual({ ...ARTICLE_NUMBER_ROUTES }, erwartet,
    "Tabelle veraltet - python scripts/sync_catalog_number_routes.py ausfuehren");
  assert.equal(ARTICLE_NUMBER_ROUTES["9642"], "280", "neueste Artikel sind enthalten");
  for (const id of ausgeschlossen) assert.equal(ARTICLE_NUMBER_ROUTES[id], undefined, `ausgeschlossene ID ${id} hat keine Weiterleitung`);
});
