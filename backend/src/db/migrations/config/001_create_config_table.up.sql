CREATE TABLE IF NOT EXISTS config (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  updatedBy TEXT NOT NULL
);

-- Pre-populate with defaults that mirror current environment variable values.
-- These act as fallbacks; the application always prefers the DB value over env
-- when the key is present in this table.
INSERT OR IGNORE INTO config (key, value, updatedAt, updatedBy) VALUES
  ('RATE_LIMIT_RPM',       '20',                 datetime('now'), 'system:migration'),
  ('VENICE_MODEL',         'default',            datetime('now'), 'system:migration'),
  ('MAX_CONCURRENT_NODES', '10',                 datetime('now'), 'system:migration'),
  ('FEATURE_FLAGS',        '{}',                 datetime('now'), 'system:migration');
