PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS notification_log;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS weights;
DROP TABLE IF EXISTS movements;
DROP TABLE IF EXISTS babies;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS households;
PRAGMA foreign_keys = ON;

-- Cacotas D1 schema — new accounts/households model (issue #16).
-- The database is intentionally reset when this model is deployed.

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  household_id TEXT REFERENCES households(id),
  provider TEXT NOT NULL,
  provider_sub TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_sub)
);
CREATE INDEX idx_users_household ON users(household_id);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  created_by TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by TEXT,
  rejected_at INTEGER,
  rejected_by TEXT
);
CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_invites_household ON invites(household_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX idx_sessions_user_device ON sessions(user_id, device_id);

CREATE TABLE movements (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  baby_seq INTEGER NOT NULL,
  size_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  usage_source TEXT,
  quantity INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  undoes_movement_id TEXT,
  note TEXT,
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  location_id TEXT
);
CREATE UNIQUE INDEX idx_movements_baby_seq ON movements(baby_id, baby_seq);
CREATE INDEX idx_movements_household ON movements(household_id);
CREATE INDEX idx_movements_baby_location ON movements(baby_id, location_id);

CREATE TABLE weights (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  baby_seq INTEGER NOT NULL,
  weight_kg REAL NOT NULL,
  length_cm REAL,
  recorded_at INTEGER NOT NULL,
  device_id TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_weights_baby_seq ON weights(baby_id, baby_seq);
CREATE INDEX idx_weights_household ON weights(household_id);

CREATE TABLE babies (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  birth_date TEXT,
  zone_id TEXT NOT NULL,
  birth_weight_kg REAL,
  sex TEXT,
  gestational_weeks INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_babies_household ON babies(household_id);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  reorder_point INTEGER NOT NULL DEFAULT 40,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  device_id TEXT NOT NULL
);
CREATE INDEX idx_locations_household ON locations(household_id);

CREATE TABLE push_subscriptions (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  keys_json TEXT NOT NULL
);

CREATE TABLE notification_log (
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  size_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  snoozed_until INTEGER,
  PRIMARY KEY (baby_id, size_id, kind)
);


CREATE INDEX idx_babies_household ON babies(household_id);

CREATE TRIGGER enforce_household_two_users_insert
BEFORE UPDATE OF household_id ON users
WHEN NEW.household_id IS NOT NULL
  AND (SELECT COUNT(*) FROM users WHERE household_id = NEW.household_id) >= 2
  AND OLD.household_id IS NOT NEW.household_id
BEGIN
  SELECT RAISE(ABORT, 'household full');
END;
