-- Lager: Kisten im Keller und welche Artikelnummer in welcher Kiste liegt (Admin-App, Bereich Lager).
-- Startbestand aus den Lagerkatalog-PDFs vom 26.07./16.08.2026 (alte Nummern, auf heutige Artikelnummern
-- umgerechnet) - alles ungeprueft (geprueft=0), der Inhaber bestaetigt im Keller.
CREATE TABLE IF NOT EXISTS lager_kisten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notiz TEXT NOT NULL DEFAULT '',
  pos INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lager_plaetze (
  artikel TEXT PRIMARY KEY,
  kiste_id INTEGER NOT NULL REFERENCES lager_kisten(id),
  geprueft INTEGER NOT NULL DEFAULT 0 CHECK (geprueft IN (0,1)),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lager_plaetze_kiste ON lager_plaetze(kiste_id);
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (1, 'Kiste 1', 'Aus der alten Liste nicht sicher zuzuordnen: alt #2 Pierre Balmain Jacke; alt #27 MM6 Maison Margiela Top Schwarz; alt #42 Walter Van Beirendonck Rock; alt #43 Walter Van Beirendonck Kurzer Rock; alt #48 Arc''teryx Yoyo Rucksack', 1, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (2, 'Kiste 2', 'Aus der alten Liste nicht sicher zuzuordnen: alt #54 Jean Paul Gaultier Spider Top; alt #69 Balmain Braun; alt #70 Balmain Jacke 3; alt #74 Jean Paul Gaultier Jacke; alt #76 Jean Paul Gaultier Unterhose; alt #78 Pierre Cardin; alt #80 Prada Jacke', 2, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (3, 'Kiste 3', 'Aus der alten Liste nicht sicher zuzuordnen: alt #82 Prada Schal Grün; alt #85 Prada Shirt Grau; alt #95 Balmain Furry; alt #108 Prada Loafer; alt #110 Prada Wool Top; alt #114 Ann Demeulemeester Top', 3, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (4, 'Kiste 4', 'Aus der alten Liste nicht sicher zuzuordnen: alt #121 Luna Rossa Sweatjacke; alt #124 Y-3 Schuhe; alt #151 Prada Strickjacke', 4, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (5, 'Kiste 5', 'Aus der alten Liste nicht sicher zuzuordnen: alt #165 Jean Paul Gaultier Soleil Federkleid Weiß', 5, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (6, 'Kiste 6', '', 6, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (7, 'Kiste 7', '', 7, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (8, 'Kiste 8', '', 8, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_kisten (id, name, notiz, pos, created_at, updated_at) VALUES (9, 'Kiste 9', '', 9, '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('3', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('4', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('5', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('6', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('7', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('8', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('9', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('11', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('13', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('16', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('18', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('32', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('33', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('35', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('39', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('45', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('43', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('46', 1, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('49', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('50', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('52', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('57', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('58', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('59', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('60', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('61', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('62', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('63', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('66', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('68', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('69', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('72', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('73', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('74', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('79', 2, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('78', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('81', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('83', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('87', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('90', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('92', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('97', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('98', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('99', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('100', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('102', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('105', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('108', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('109', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('111', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('112', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('113', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('114', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('115', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('117', 3, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('119', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('120', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('123', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('126', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('127', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('128', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('129', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('131', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('132', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('133', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('135', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('136', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('139', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('140', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('142', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('144', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('145', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('146', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('150', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('151', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('152', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('153', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('156', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('157', 4, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('158', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('159', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('162', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('161', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('163', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('165', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('166', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('167', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('168', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('170', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('172', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('173', 5, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('181', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('182', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('183', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('184', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('185', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('186', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('187', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('188', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('189', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('190', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('191', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('192', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('193', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('194', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('195', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('196', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('197', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('198', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('199', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('200', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('201', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('202', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('203', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('204', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('205', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('206', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('207', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('208', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('209', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('210', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('211', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('212', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('213', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('214', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('215', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('216', 6, 0, '2026-11-13T00:00:00.000Z');
INSERT OR IGNORE INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES ('217', 6, 0, '2026-11-13T00:00:00.000Z');
