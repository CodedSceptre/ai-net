-- Preserve the existing chart history and keep it after an agent is removed.
CREATE TABLE weighted_reputation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agentId TEXT NOT NULL,
  taskId TEXT NOT NULL DEFAULT '',
  nodeId TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL,
  timestamp TEXT NOT NULL,
  breakdown TEXT,
  calculatedAt TEXT
);
INSERT INTO weighted_reputation_history (id, agentId, taskId, nodeId, score, timestamp)
SELECT id, agentId, taskId, nodeId, score, timestamp FROM reputation_history;
DROP TABLE reputation_history;
ALTER TABLE weighted_reputation_history RENAME TO reputation_history;
CREATE INDEX idx_reputation_history_agent_timestamp ON reputation_history (agentId, timestamp);

CREATE TABLE reputation_node_outcomes (
  agentId TEXT NOT NULL,
  taskId TEXT NOT NULL,
  nodeId TEXT NOT NULL,
  successful INTEGER NOT NULL CHECK (successful IN (0, 1)),
  responseMs INTEGER NOT NULL CHECK (responseMs >= 0),
  PRIMARY KEY (agentId, taskId, nodeId)
);

CREATE TABLE reputation_disputes (
  agentId TEXT NOT NULL,
  disputeId TEXT NOT NULL,
  lost INTEGER NOT NULL CHECK (lost IN (0, 1)),
  PRIMARY KEY (agentId, disputeId)
);

CREATE TABLE reputation_uptime (
  agentId TEXT PRIMARY KEY,
  onlineMinutes INTEGER NOT NULL,
  totalMonitoredMinutes INTEGER NOT NULL,
  lastSampleMinute INTEGER NOT NULL
);
