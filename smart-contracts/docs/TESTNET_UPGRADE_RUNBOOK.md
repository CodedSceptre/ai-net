# 🛡️ Testnet Contract Upgrade & Rollback Runbook

This runbook provides an operator guide for executing smart contract upgrades on the **Stellar Testnet**, verifying data migration integrity, and performing emergency rollbacks without loss of state or funds.

---

## Table of Contents

1. [Overview & Safety Principles](#1-overview--safety-principles)
2. [Pre-Upgrade Checklist](#2-pre-upgrade-checklist)
3. [Deterministic Build & Artifact Generation](#3-deterministic-build--artifact-generation)
4. [Step-by-Step Upgrade Execution](#4-step-by-step-upgrade-execution)
5. [Post-Upgrade Verification & State Equivalence](#5-post-upgrade-verification--state-equivalence)
6. [Emergency Rollback Procedure](#6-emergency-rollback-procedure)
7. [Automated CI Verification](#7-automated-ci-verification)

---

## 1. Overview & Safety Principles

All on-chain contracts in **ai-net** (Agent Registry, Upgrade Manager, Error Registry, Agent Bidding) follow strict upgrade safety invariants:

- **Zero State Loss**: Existing instance, persistent, and temporary storage keys must either remain bitwise identical or be transformed through deterministic post-upgrade migration hooks.
- **Rollback Window**: Every executed upgrade records a snapshot of the prior WASM hash and version, permitting an emergency rollback within **34,560 ledgers (~48 hours)**.
- **Authorization**: Only the registered admin keypair (`ADMIN_ADDRESS`) can propose, validate, execute, or roll back upgrades.

---

## 2. Pre-Upgrade Checklist

Before initiating an upgrade on Testnet:

- [ ] Target network is set to `testnet` in environment.
- [ ] `STELLAR_SECRET_KEY` is loaded and funded with sufficient XLM for transaction fees and storage rent.
- [ ] Automated integration tests pass locally: `npm run test:upgrade`.
- [ ] Current on-chain version and WASM hash are queried and recorded.
- [ ] On-chain state backup snapshot is generated.

```bash
# Export environment variables
export NETWORK="testnet"
export STELLAR_SECRET_KEY="S..."
export UPGRADE_MANAGER_ID="C..."
export CONTRACT_ID="C..."
export ADMIN_ADDRESS="G..."
```

---

## 3. Deterministic Build & Artifact Generation

To guarantee reproducibility and prevent hash mismatch:

```bash
cd smart-contracts

# 1. Build optimized Wasm binaries
cargo build --locked --target wasm32v1-none --release -p agent-registry

# 2. Compute SHA-256 WASM hash
export NEW_WASM_FILE="target/wasm32v1-none/release/agent_registry.wasm"
export NEW_WASM_HASH=$(sha256sum $NEW_WASM_FILE | awk '{print $1}')

echo "Deterministic WASM Hash: $NEW_WASM_HASH"

# 3. Upload new WASM bytecode to Stellar Testnet
export WASM_ID=$(stellar contract install \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --wasm $NEW_WASM_FILE)

echo "Installed WASM ID: $WASM_ID"
```

---

## 4. Step-by-Step Upgrade Execution

### Managed Upgrade Proposal

Configure the manager's multisig governance address and authorize the manager
as the target contract's upgrade administrator. Use the target's current
version and the installed WASM hash. The target's upgrade hook owns migration.

```bash
# Submit with the configured multisig governance authorization.
stellar contract invoke \
  --network "$NETWORK" \
  --source-account "$GOVERNANCE_IDENTITY" \
  --id "$UPGRADE_MANAGER_ID" \
  -- propose_upgrade \
  --contract "$AGENT_REGISTRY_ID" \
  --new_wasm_hash "$NEW_WASM_HASH" \
  --from_version "$CURRENT_VERSION" \
  --to_version "$TARGET_VERSION"

# Execute with manager admin authorization after the 48-hour window.
stellar contract invoke \
  --network "$NETWORK" \
  --source-account "$ADMIN_IDENTITY" \
  --id "$UPGRADE_MANAGER_ID" \
  -- execute_upgrade --proposal_id "$PROPOSAL_ID"
```

Record the proposal ID from the first invocation. Verify the target's version
and update deployment metadata after execution. The manager's own WASM
continues to use `propose_self_upgrade`, `validate_proposal`, and
`execute_self_upgrade`.


---

## 5. Post-Upgrade Verification & State Equivalence

Immediately following execution, run automated verification checks:

### 5.1 Verify Version & Hash
```bash
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $UPGRADE_MANAGER_ID \
  -- get_current_version
```
*Expected Output:* `version: "2.0.0"`, `wasm_hash: <NEW_WASM_HASH>`.

### 5.2 Assert State Equivalence
Query pre-existing testnet entities to verify 100% data fidelity:

```bash
# Query agent record created prior to upgrade
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $CONTRACT_ID \
  -- get_agent \
  --agent_id "agent-testnet-01"

# Query composite index
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $CONTRACT_ID \
  -- get_agents_by_capability \
  --capability "research"
```

---

## 6. Emergency Rollback Procedure

If data corruption, logic regressions, or unexpected transaction aborts occur post-upgrade:

### Step 6.1: Check Rollback Eligibility
```bash
# Check if current ledger is within the 48h (34,560 ledger) rollback window
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $UPGRADE_MANAGER_ID \
  -- can_rollback
```
*If `true`, proceed immediately.*

### Step 6.2: Execute Emergency Rollback

#### Option A: Via Upgrade Manager (Recommended)
```bash
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $UPGRADE_MANAGER_ID \
  -- rollback_upgrade
```

#### Option B: Direct Contract Rollback (Fallback)
```bash
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $CONTRACT_ID \
  -- emergency_rollback \
  --rollback_wasm_hash $PREVIOUS_WASM_HASH \
  --rollback_version "1.0.0"
```

### Step 6.3: Post-Rollback Sanity Verification
```bash
# Confirm version reverted to v1.0.0
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $UPGRADE_MANAGER_ID \
  -- get_current_version

# Verify active records respond normally
stellar contract invoke \
  --network $NETWORK \
  --source-account $STELLAR_SECRET_KEY \
  --id $CONTRACT_ID \
  -- list_agents
```

---

## 7. Automated CI Verification

Contract upgrades and state equivalence assertions are automated in CI:

```bash
# Run upgrade and migration verification tests
cd smart-contracts
npm run test:upgrade
```

This suite executes on every PR to prevent regression in upgrade compatibility, schema transformations, and rollback deadlines.
