CREATE TABLE treatments (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  record_json TEXT NOT NULL
);
CREATE INDEX idx_treatments_household ON treatments(household_id);

CREATE TABLE dose_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  record_json TEXT NOT NULL
);
CREATE INDEX idx_dose_records_household ON dose_records(household_id);

CREATE TABLE medical_appointments (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  record_json TEXT NOT NULL
);
CREATE INDEX idx_medical_appointments_household ON medical_appointments(household_id);

CREATE TABLE health_notification_log (
  notification_key TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id),
  device_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (notification_key, device_id)
);
CREATE INDEX idx_health_notification_household ON health_notification_log(household_id);
