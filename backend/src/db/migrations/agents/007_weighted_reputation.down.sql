DROP TABLE reputation_uptime;
DROP TABLE reputation_disputes;
DROP TABLE reputation_node_outcomes;
CREATE TABLE legacy_reputation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agentId TEXT NOT NULL,
  taskId TEXT NOT NULL,
  nodeId TEXT NOT NULL,
  score REAL NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (agentId) REFERENCES agents(id) ON DELETE CASCADE
);
INSERT INTO legacy_reputation_history (id, agentId, taskId, nodeId, score, timestamp)
SELECT history.id, history.agentId, history.taskId, history.nodeId, history.score, history.timestamp
FROM reputation_history AS history
JOIN agents ON agents.id = history.agentId;
DROP TABLE reputation_history;
ALTER TABLE legacy_reputation_history RENAME TO reputation_history;
CREATE INDEX idx_reputation_history_agent_timestamp ON reputation_history (agentId, timestamp);
