-- Universe Mode / Warp Hunt leaderboard + earned coupons.
-- Public leaderboard data contains only username, score and timestamp.
-- Coupon codes are never returned by leaderboard queries.

CREATE TABLE IF NOT EXISTS game_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT,
  username TEXT,
  score INTEGER,
  reward_earned INTEGER NOT NULL DEFAULT 0 CHECK (reward_earned IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  reward_earned INTEGER NOT NULL DEFAULT 0 CHECK (reward_earned IN (0,1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES game_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_game_scores_rank
  ON game_scores(score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_game_scores_username
  ON game_scores(username, score DESC);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  percent_off INTEGER NOT NULL DEFAULT 10 CHECK (percent_off > 0 AND percent_off <= 100),
  status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','RESERVED','REDEEMED','EXPIRED','CANCELLED')),
  source TEXT NOT NULL,
  source_run_id TEXT UNIQUE,
  username TEXT,
  score INTEGER,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reserved_order_id TEXT,
  reservation_expires_at TEXT,
  redeemed_at TEXT,
  redeemed_order_id TEXT,
  FOREIGN KEY (source_run_id) REFERENCES game_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_coupons_status_expiry
  ON coupons(status, expires_at);
