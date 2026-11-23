CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  walletPublicKey TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  createdAt INTEGER NOT NULL,
  disabledAt INTEGER
);
CREATE INDEX webhooks_wallet ON webhooks(walletPublicKey, id);

CREATE TABLE webhook_jobs (
  id INTEGER PRIMARY KEY,
  webhookId TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  eventKey TEXT,
  eventType TEXT NOT NULL,
  payload TEXT NOT NULL,
  nextAttemptAt INTEGER,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  UNIQUE(webhookId, eventKey)
);
CREATE INDEX webhook_jobs_pending ON webhook_jobs(nextAttemptAt) WHERE nextAttemptAt IS NOT NULL;

CREATE TABLE webhook_deliveries (
  id INTEGER PRIMARY KEY,
  webhookId TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  jobId INTEGER NOT NULL REFERENCES webhook_jobs(id) ON DELETE CASCADE,
  eventType TEXT NOT NULL,
  payload TEXT NOT NULL,
  statusCode INTEGER,
  attemptCount INTEGER NOT NULL,
  lastAttemptAt INTEGER NOT NULL,
  success INTEGER NOT NULL,
  UNIQUE(jobId, attemptCount)
);
CREATE INDEX webhook_deliveries_history ON webhook_deliveries(webhookId, id DESC);
CREATE INDEX webhook_deliveries_health ON webhook_deliveries(webhookId, lastAttemptAt);
