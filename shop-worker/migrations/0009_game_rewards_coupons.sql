-- Disorder119 Warp-Jagd leaderboard + one-use reward coupons.
-- Public leaderboard stores only the user-chosen display name and score.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUBMITTED','EXPIRED')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submitted_at TEXT,
  reward_issued_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_expiry ON game_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES game_sessions(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_scores_rank ON game_scores(score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'PERCENT' CHECK (kind = 'PERCENT'),
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
  source TEXT NOT NULL DEFAULT 'WARP_JAGD',
  issued_session_id TEXT UNIQUE REFERENCES game_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESERVED','REDEEMED','DISABLED')),
  reserved_order_id TEXT REFERENCES commerce_orders(id) ON DELETE SET NULL,
  reservation_expires_at TEXT,
  redeemed_order_id TEXT REFERENCES commerce_orders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status, reservation_expires_at);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES commerce_orders(id) ON DELETE CASCADE,
  original_amount_cents INTEGER NOT NULL CHECK (original_amount_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  discounted_amount_cents INTEGER NOT NULL CHECK (discounted_amount_cents >= 0),
  created_at TEXT NOT NULL,
  redeemed_at TEXT,
  UNIQUE(coupon_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id, created_at);

-- Payment completion can arrive through the browser capture route or solely via
-- PayPal webhook. Redeem the reserved coupon at the database boundary in both
-- cases so an already-paid reward can never become reusable after reservation expiry.
CREATE TRIGGER IF NOT EXISTS trg_coupon_redeem_paid_order
AFTER UPDATE OF status ON commerce_orders
WHEN NEW.status = 'PAID' AND OLD.status <> 'PAID'
BEGIN
  UPDATE coupons
     SET status = 'REDEEMED',
         redeemed_order_id = NEW.id,
         redeemed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         reservation_expires_at = NULL
   WHERE reserved_order_id = NEW.id
     AND status = 'RESERVED';

  UPDATE coupon_redemptions
     SET redeemed_at = COALESCE(redeemed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   WHERE order_id = NEW.id;
END;

-- If checkout setup fails after a purchase reservation was created, release the
-- unique item through the existing legal state transitions. This avoids a
-- temporary ghost reservation while preserving the stricter 0003 state machine.
CREATE TRIGGER IF NOT EXISTS trg_purchase_cancel_release_inventory
AFTER UPDATE OF status ON reservations
WHEN NEW.kind = 'PURCHASE' AND NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED'
BEGIN
  UPDATE inventory
     SET status = 'CANCELLED',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         version = version + 1
   WHERE id = NEW.inventory_id
     AND status IN ('RESERVED','PAYMENT_PENDING');

  UPDATE inventory
     SET status = 'AVAILABLE',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         version = version + 1
   WHERE id = NEW.inventory_id
     AND status = 'CANCELLED';
END;
