CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  actorWallet TEXT,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  payload TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT
);

CREATE TRIGGER prevent_audit_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are immutable: UPDATE not allowed');
END;

CREATE TRIGGER prevent_audit_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are immutable: DELETE not allowed');
END;
