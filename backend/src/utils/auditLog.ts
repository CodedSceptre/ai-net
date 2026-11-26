import Database from 'better-sqlite3';

export interface AuditEventInput {
  action: string;
  actorWallet?: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditRow {
  id: number;
  timestamp: string;
  action: string;
  actorWallet: string | null;
  entityType: string;
  entityId: string;
  payload: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditQueryParams {
  entityId?: string;
  entityType?: string;
  action?: string;
  actorWallet?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export const SENSITIVE_FIELDS = ['privateKey', 'secret', 'password', 'token', 'Authorization'];

export function scrubPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sensitiveSet = new Set(SENSITIVE_FIELDS.map((f) => f.toLowerCase()));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (sensitiveSet.has(key.toLowerCase())) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = scrubPayload(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function logAuditEvent(db: Database.Database, event: AuditEventInput): void {
  const scrubbed = scrubPayload(event.payload);
  db.prepare(`
    INSERT INTO audit_log (timestamp, action, actorWallet, entityType, entityId, payload, ipAddress, userAgent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    event.action,
    event.actorWallet ?? null,
    event.entityType,
    event.entityId,
    JSON.stringify(scrubbed),
    event.ipAddress ?? null,
    event.userAgent ?? null,
  );
}

function applyAuditSchema(db: Database.Database): void {
  db.exec(`
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

    CREATE TRIGGER IF NOT EXISTS prevent_audit_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log rows are immutable: UPDATE not allowed');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log rows are immutable: DELETE not allowed');
    END;
  `);
}

export function createAuditDb(db: Database.Database): {
  log(event: AuditEventInput): void;
  query(params: AuditQueryParams): { data: AuditRow[]; total: number; page: number; totalPages: number };
} {
  applyAuditSchema(db);

  return {
    log(event: AuditEventInput): void {
      logAuditEvent(db, event);
    },

    query(params: AuditQueryParams): { data: AuditRow[]; total: number; page: number; totalPages: number } {
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 20));
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const args: unknown[] = [];

      if (params.entityId !== undefined) {
        conditions.push('entityId = ?');
        args.push(params.entityId);
      }
      if (params.entityType !== undefined) {
        conditions.push('entityType = ?');
        args.push(params.entityType);
      }
      if (params.action !== undefined) {
        conditions.push('action = ?');
        args.push(params.action);
      }
      if (params.actorWallet !== undefined) {
        conditions.push('actorWallet = ?');
        args.push(params.actorWallet);
      }
      if (params.from !== undefined) {
        conditions.push('timestamp >= ?');
        args.push(params.from);
      }
      if (params.to !== undefined) {
        conditions.push('timestamp <= ?');
        args.push(params.to);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRow = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...args) as { count: number };
      const total = countRow.count;

      const data = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as AuditRow[];

      return {
        data,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    },
  };
}
