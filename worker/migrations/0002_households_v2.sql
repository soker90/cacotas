-- D1 is intentionally reset for issue #16; do not migrate the legacy schema.
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
  UNIQUE(provider, provider_sub)
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

CREATE TRIGGER enforce_household_two_users_update
BEFORE UPDATE OF household_id ON users
WHEN NEW.household_id IS NOT NULL
 AND OLD.household_id IS NOT NEW.household_id
 AND (SELECT COUNT(*) FROM users WHERE household_id = NEW.household_id) >= 2
BEGIN SELECT RAISE(ABORT, 'household full'); END;
