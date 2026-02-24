CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regions (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, code)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'REGION')),
  region_id BIGINT REFERENCES regions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('PICKUP', 'UPDATE', 'MAINTENANCE', 'EVENT', 'CAMPAIGN')),
  trigger TEXT NOT NULL CHECK (trigger IN ('ON_START', 'ON_END', 'BEFORE_END', 'BEFORE_START', 'ON_PUBLISH')),
  offset_minutes INT,
  channel TEXT NOT NULL CHECK (channel IN ('WEBPUSH', 'EMAIL', 'DISCORD')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PICKUP', 'UPDATE', 'MAINTENANCE', 'EVENT', 'CAMPAIGN')),
  title TEXT NOT NULL,
  summary TEXT,
  start_at_utc TIMESTAMPTZ,
  end_at_utc TIMESTAMPTZ,
  source_url TEXT NOT NULL,
  image_url TEXT,
  canonical_event_key TEXT NOT NULL UNIQUE,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'NEED_REVIEW', 'HIDDEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('RSS', 'HTML_LIST', 'HTML_DETAIL', 'API')),
  base_url TEXT NOT NULL,
  list_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  fetch_interval_minutes INT NOT NULL DEFAULT 30,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_notices (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_text TEXT,
  content_hash TEXT,
  raw_payload JSONB,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'PARSED', 'ERROR')),
  UNIQUE (source_id, url)
);

CREATE TABLE IF NOT EXISTS event_raw_links (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  raw_notice_id BIGINT NOT NULL REFERENCES raw_notices(id) ON DELETE CASCADE,
  UNIQUE (event_id, raw_notice_id)
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_rules_updated_at ON notification_rules;
CREATE TRIGGER trg_notification_rules_updated_at
BEFORE UPDATE ON notification_rules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_regions_game_id ON regions(game_id);
CREATE INDEX IF NOT EXISTS idx_events_region_start ON events(region_id, start_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_region_end ON events(region_id, end_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_type_start ON events(type, start_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);
CREATE INDEX IF NOT EXISTS idx_raw_notices_source_fetched ON raw_notices(source_id, fetched_at DESC);
