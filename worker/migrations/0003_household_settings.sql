CREATE TABLE household_settings (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  warning_days INTEGER NOT NULL DEFAULT 7,
  coverage_days INTEGER NOT NULL DEFAULT 21,
  stay_mode INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL DEFAULT ''
);
