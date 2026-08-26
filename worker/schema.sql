-- Cacotas D1 schema (SPEC.md §4.5)
-- Append-only ledger: rows are only ever INSERTed (D-02). The seq column is
-- assigned by SQLite and doubles as the sync cursor.

CREATE TABLE IF NOT EXISTS movements (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- cursor, assigned by the server
  id         TEXT NOT NULL UNIQUE,               -- client UUID → idempotency
  baby_id    TEXT NOT NULL,
  size_id    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  usage_source TEXT,
  quantity   INTEGER NOT NULL,
  delta      INTEGER NOT NULL,
  undoes_movement_id TEXT,
  note       TEXT,
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  device_id  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_seq ON movements(seq);

CREATE TABLE IF NOT EXISTS weights (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  baby_id    TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  recorded_at INTEGER NOT NULL,
  device_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS babies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  birth_date TEXT,
  zone_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Used by phase 5 (Web Push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  device_id  TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  keys_json  TEXT NOT NULL
);

-- Used by phase 5 (notification anti-spam)
CREATE TABLE IF NOT EXISTS notification_log (
  baby_id    TEXT NOT NULL,
  size_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  snoozed_until INTEGER,
  PRIMARY KEY (baby_id, size_id, kind)
);
