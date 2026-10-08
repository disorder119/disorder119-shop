-- Testshop (api-test.disorder119.com, SANDBOX="1"): Stuecke, die dort
-- verkauft wurden. Der Testshop schreibt nie in den echten Katalog auf
-- GitHub; sandbox.js legt den Verkauf hier ab und blendet ihn ueber den
-- oeffentlichen Katalog. In der echten Datenbank bleibt die Tabelle leer.
CREATE TABLE IF NOT EXISTS sandbox_verkauft (
  item_id TEXT PRIMARY KEY,
  verkauft_am TEXT NOT NULL
);
