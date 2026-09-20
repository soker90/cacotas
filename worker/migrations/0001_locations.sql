CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reorder_point INTEGER NOT NULL DEFAULT 40,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  device_id TEXT NOT NULL
);

ALTER TABLE movements ADD COLUMN location_id TEXT;

INSERT OR IGNORE INTO locations (id, name, reorder_point, created_at, updated_at, device_id)
SELECT 'default:' || id, 'Casa', 40, created_at, updated_at, 'migration'
FROM babies;

UPDATE movements
SET location_id = 'default:' || baby_id
WHERE location_id IS NULL;
