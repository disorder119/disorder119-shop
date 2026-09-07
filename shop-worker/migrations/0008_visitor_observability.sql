-- First-party visitor/session observability for the Disorder119 owner dashboard.
-- No fingerprint, advertising identifier or raw IP address is stored.

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  landing_path TEXT,
  last_path TEXT,
  landing_title TEXT,
  last_title TEXT,
  initial_referrer TEXT,
  last_referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  language TEXT,
  device_type TEXT,
  browser TEXT,
  platform TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  country TEXT,
  region TEXT,
  city TEXT,
  colo TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visitor_pageviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES visitor_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_seen ON visitor_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_first_seen ON visitor_sessions(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_path ON visitor_sessions(last_path);
CREATE INDEX IF NOT EXISTS idx_visitor_pageviews_session_time ON visitor_pageviews(session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_pageviews_time ON visitor_pageviews(occurred_at DESC);
