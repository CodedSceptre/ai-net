import Database from 'better-sqlite3';
import { scrubPayload, logAuditEvent, createAuditDb, SENSITIVE_FIELDS } from './auditLog';

describe('scrubPayload', () => {
  it('removes privateKey', () => {
    const result = scrubPayload({ privateKey: 'secret123', name: 'test' });
    expect(result).not.toHaveProperty('privateKey');
    expect(result.name).toBe('test');
  });

  it('removes secret', () => {
    const result = scrubPayload({ secret: 'abc', data: 1 });
    expect(result).not.toHaveProperty('secret');
  });

  it('removes password', () => {
    const result = scrubPayload({ password: 'pw', user: 'alice' });
    expect(result).not.toHaveProperty('password');
  });

  it('removes token', () => {
    const result = scrubPayload({ token: 'tok', action: 'login' });
    expect(result).not.toHaveProperty('token');
  });

  it('removes Authorization', () => {
    const result = scrubPayload({ Authorization: 'Bearer xyz', path: '/api' });
    expect(result).not.toHaveProperty('Authorization');
  });

  it('removes nested sensitive fields', () => {
    const result = scrubPayload({ user: { privateKey: 'k', name: 'bob' } });
    expect((result.user as any).privateKey).toBeUndefined();
    expect((result.user as any).name).toBe('bob');
  });

  it('leaves non-sensitive fields intact', () => {
    const result = scrubPayload({ taskId: 'abc', amount: 10 });
    expect(result).toEqual({ taskId: 'abc', amount: 10 });
  });
});

describe('logAuditEvent', () => {
  function makeDb() {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      actorWallet TEXT,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      payload TEXT NOT NULL,
      ipAddress TEXT,
      userAgent TEXT
    )`);
    return db;
  }

  it('inserts a row with correct fields', () => {
    const db = makeDb();
    logAuditEvent(db, {
      action: 'POST:/api/agents',
      actorWallet: 'GABC123',
      entityType: 'agent',
      entityId: 'agent-1',
      payload: { name: 'test' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });
    const row = db.prepare('SELECT * FROM audit_log').get() as any;
    expect(row.action).toBe('POST:/api/agents');
    expect(row.actorWallet).toBe('GABC123');
    expect(row.entityType).toBe('agent');
    expect(row.entityId).toBe('agent-1');
    expect(JSON.parse(row.payload)).toEqual({ name: 'test' });
  });

  it('scrubs sensitive fields before inserting', () => {
    const db = makeDb();
    logAuditEvent(db, {
      action: 'POST:/api/auth',
      entityType: 'auth',
      entityId: 'sess-1',
      payload: { privateKey: 'SK123', secret: 'abc', username: 'alice' },
    });
    const row = db.prepare('SELECT * FROM audit_log').get() as any;
    const payload = JSON.parse(row.payload);
    expect(payload).not.toHaveProperty('privateKey');
    expect(payload).not.toHaveProperty('secret');
    expect(payload.username).toBe('alice');
  });
});

describe('createAuditDb.query', () => {
  function makeDb() {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      actorWallet TEXT,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      payload TEXT NOT NULL,
      ipAddress TEXT,
      userAgent TEXT
    )`);
    return db;
  }

  it('returns paginated results', () => {
    const db = makeDb();
    const auditDb = createAuditDb(db);
    for (let i = 0; i < 15; i++) {
      auditDb.log({ action: 'POST:/api/agents', entityType: 'agent', entityId: `agent-${i}`, payload: {} });
    }
    const page1 = auditDb.query({ page: 1, limit: 10 });
    expect(page1.data.length).toBe(10);
    expect(page1.total).toBe(15);
    expect(page1.totalPages).toBe(2);
    const page2 = auditDb.query({ page: 2, limit: 10 });
    expect(page2.data.length).toBe(5);
  });

  it('filters by entityId', () => {
    const db = makeDb();
    const auditDb = createAuditDb(db);
    auditDb.log({ action: 'POST:/api/agents', entityType: 'agent', entityId: 'agent-A', payload: {} });
    auditDb.log({ action: 'POST:/api/agents', entityType: 'agent', entityId: 'agent-B', payload: {} });
    const result = auditDb.query({ entityId: 'agent-A' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].entityId).toBe('agent-A');
  });

  it('filters by date range', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO audit_log (timestamp, action, entityType, entityId, payload) VALUES (?, ?, ?, ?, ?)`).run(
      '2024-01-15T00:00:00.000Z', 'POST:/api/agents', 'agent', 'a1', '{}'
    );
    db.prepare(`INSERT INTO audit_log (timestamp, action, entityType, entityId, payload) VALUES (?, ?, ?, ?, ?)`).run(
      '2024-02-15T00:00:00.000Z', 'POST:/api/agents', 'agent', 'a2', '{}'
    );
    const auditDb = createAuditDb(db);
    const result = auditDb.query({ from: '2024-01-01', to: '2024-01-31' });
    expect(result.data.length).toBe(1);
    expect(result.data[0].entityId).toBe('a1');
  });
});
