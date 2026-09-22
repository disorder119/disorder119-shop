-- Disorder119 secret games: short-lived signed runs, public scoreboards and one-time rewards.
CREATE TABLE IF NOT EXISTS game_runs (
  id TEXT PRIMARY KEY,
  run_token_hash TEXT NOT NULL,
  game_id TEXT NOT NULL CHECK (game_id IN ('warp','signal','memory')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_runs_expires ON game_runs(expires_at);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL CHECK (game_id IN ('warp','signal','memory')),
  username TEXT NOT NULL,
  username_key TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  detail_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES game_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_game_scores_board
  ON game_scores(game_id, score DESC, duration_ms ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_game_scores_username
  ON game_scores(username_key, created_at DESC);

CREATE TABLE IF NOT EXISTS reward_coupons (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT,
  discount_bps INTEGER NOT NULL DEFAULT 1000 CHECK (discount_bps > 0 AND discount_bps <= 10000),
  source_game TEXT CHECK (source_game IS NULL OR source_game IN ('warp','signal','memory')),
  source_score_id TEXT UNIQUE,
  username_key TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESERVED','REDEEMED','VOID')),
  reserved_order_id TEXT,
  reserved_until TEXT,
  redeemed_order_id TEXT,
  created_at TEXT NOT NULL,
  redeemed_at TEXT,
  FOREIGN KEY (source_score_id) REFERENCES game_scores(id)
);

CREATE INDEX IF NOT EXISTS idx_reward_coupons_status ON reward_coupons(status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_reward_coupons_user ON reward_coupons(username_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_coupons_order ON reward_coupons(reserved_order_id);
