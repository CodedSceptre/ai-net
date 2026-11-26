CREATE TABLE IF NOT EXISTS workspaces (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  ownerWallet TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspaceId    TEXT NOT NULL,
  walletPublicKey TEXT NOT NULL,
  role           TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
  addedAt        TEXT NOT NULL,
  PRIMARY KEY (workspaceId, walletPublicKey),
  FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_wallet
  ON workspace_members(walletPublicKey);
