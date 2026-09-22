-- Disorder119 one-time reward coupon checkout lifecycle.
-- Apply after 0009_secret_games.sql.

-- A PayPal completion may be processed by the browser capture route or only by
-- the verified webhook. Redeem the coupon whenever the order reaches PAID so
-- browser closure cannot make an already-used code reusable later.
CREATE TRIGGER IF NOT EXISTS trg_reward_coupon_redeem_paid_order
AFTER UPDATE OF status ON commerce_orders
FOR EACH ROW
WHEN NEW.status = 'PAID' AND OLD.status <> 'PAID'
BEGIN
  UPDATE reward_coupons
     SET status = 'REDEEMED',
         redeemed_order_id = NEW.id,
         redeemed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         reserved_until = NULL
   WHERE status = 'RESERVED'
     AND reserved_order_id = NEW.id;
END;

-- Failed/cancelled checkout setup must not burn a one-time game reward.
CREATE TRIGGER IF NOT EXISTS trg_reward_coupon_release_cancelled_order
AFTER UPDATE OF status ON commerce_orders
FOR EACH ROW
WHEN NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED'
BEGIN
  UPDATE reward_coupons
     SET status = 'ACTIVE',
         reserved_order_id = NULL,
         reserved_until = NULL
   WHERE status = 'RESERVED'
     AND reserved_order_id = NEW.id;
END;
