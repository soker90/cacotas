CREATE TABLE height_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  baby_seq INTEGER NOT NULL,
  height_cm REAL NOT NULL,
  recorded_at INTEGER NOT NULL,
  device_id TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_height_records_baby_seq ON height_records(baby_id, baby_seq);
CREATE INDEX idx_height_records_household ON height_records(household_id);
