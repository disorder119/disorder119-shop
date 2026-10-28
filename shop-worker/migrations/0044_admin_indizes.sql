-- Admin-App schneller (perf/admin-api): Verlauf einer Bestellung, einer Miete
-- oder Mietgruppe sucht in audit_events nach entity_id. Der vorhandene Index
-- (entity_type, entity_id, created_at) passt dazu nicht, weil die Abfragen
-- entity_id auch ohne entity_type suchen ("WHERE entity_id=? OR ...") - D1
-- las dafuer live die ganze Tabelle (28.10.2026: 3057 Zeilen, 16,8 ms fuer
-- einen Treffer), und sie waechst mit jeder Bestellung.
CREATE INDEX IF NOT EXISTS idx_audit_entity_id ON audit_events(entity_id, created_at);
