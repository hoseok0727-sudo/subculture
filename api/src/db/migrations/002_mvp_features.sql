ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'USER';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('USER', 'ADMIN'));
  END IF;
END
$$;

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE raw_notices
  ADD COLUMN IF NOT EXISTS parser_version TEXT NOT NULL DEFAULT 'v1';

CREATE TABLE IF NOT EXISTS user_games (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_id BIGINT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, region_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_schedules (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('WEBPUSH', 'EMAIL', 'DISCORD')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('ON_START', 'ON_END', 'BEFORE_END', 'BEFORE_START', 'ON_PUBLISH')),
  trigger_offset_minutes INT NOT NULL DEFAULT 0,
  scheduled_at_utc TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED')) DEFAULT 'PENDING',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES notification_schedules(id) ON DELETE CASCADE,
  sent_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAILED')),
  error_message TEXT,
  response_payload JSONB
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('MANUAL', 'SCHEDULED', 'REPARSE')),
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PARTIAL')),
  fetched_count INT NOT NULL DEFAULT 0,
  parsed_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  log_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_user_games_updated_at ON user_games;
CREATE TRIGGER trg_user_games_updated_at
BEFORE UPDATE ON user_games
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_schedules_updated_at ON notification_schedules;
CREATE TRIGGER trg_notification_schedules_updated_at
BEFORE UPDATE ON notification_schedules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_user_games_user_enabled ON user_games(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_user_games_region_enabled ON user_games(region_id, enabled);
CREATE INDEX IF NOT EXISTS idx_notification_rules_user_enabled ON notification_rules(user_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_rules_dedupe
  ON notification_rules(user_id, scope, COALESCE(region_id, 0), event_type, trigger, COALESCE(offset_minutes, 0), channel);
CREATE INDEX IF NOT EXISTS idx_notification_schedules_status_time ON notification_schedules(status, scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_notification_schedules_event ON notification_schedules(event_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_enabled_interval ON sources(enabled, fetch_interval_minutes);
CREATE INDEX IF NOT EXISTS idx_sources_region_enabled ON sources(region_id, enabled);
CREATE INDEX IF NOT EXISTS idx_raw_notices_status ON raw_notices(status);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_started_at ON ingest_runs(started_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_rules_scope_region_check'
  ) THEN
    ALTER TABLE notification_rules
      ADD CONSTRAINT notification_rules_scope_region_check
      CHECK (
        (scope = 'GLOBAL' AND region_id IS NULL)
        OR (scope = 'REGION' AND region_id IS NOT NULL)
      );
  END IF;
END
$$;
