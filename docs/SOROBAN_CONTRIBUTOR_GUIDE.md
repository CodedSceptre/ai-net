# Soroban Smart Contract Contributor Guide

This guide covers the full development lifecycle for ai-net Soroban smart contracts: local environment setup, contract conventions, testing patterns, deployment, gas optimization, upgradeability, and common pitfalls. It is the authoritative reference for anyone writing or reviewing Rust contracts in `/workspaces/ai-net/smart-contracts/`.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Development Setup](#2-local-development-setup)
3. [Contract Structure Conventions](#3-contract-structure-conventions)
4. [Testing Patterns](#4-testing-patterns)
5. [Deployment Workflow](#5-deployment-workflow)
6. [Gas Optimization Tips](#6-gas-optimization-tips)
7. [Upgradeability Patterns](#7-upgradeability-patterns)
8. [Common Soroban Pitfalls](#8-common-soroban-pitfalls)

---

## 1. Prerequisites

Install the following tools before writing or running any contract code.

### Rust stable (1.75+)

```bash
# Install rustup if you do not already have it
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify version (must be >= 1.75)
rustc --version

# Add the Wasm compilation target
rustup target add wasm32-unknown-unknown
```

### Soroban / Stellar CLI (22.0.1)

The Soroban CLI is published as the `stellar-cli` crate and exposes both the `soroban` and `stellar` command names.

```bash
cargo install --locked stellar-cli --version 22.0.1 --features opt

# Verify
stellar --version
soroban --version
```

### Docker 24+

Required to run the local Stellar standalone node.

```bash
# Verify Docker is installed and running
docker --version   # must be >= 24.0.0
docker info
```

### wasm-opt (Binaryen)

Minimizes WASM binary size after `cargo build`.

```bash
cargo install wasm-opt

# Verify
wasm-opt --version
```

---

## 2. Local Development Setup

### Start the Stellar standalone node

Run a local single-node Stellar network with Soroban RPC enabled:

```bash
docker run --rm -it \
  -p 8000:8000 \
  --name stellar \
  stellar/quickstart:latest \
  --standalone \
  --enable-soroban-rpc
```

The node is ready when you see `Listening on 0.0.0.0:8000`. Leave this terminal open.

### Configure the CLI to use the standalone network

```bash
stellar network add standalone \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"

# Generate a funded test account
stellar keys generate alice --network standalone --fund
```

### Build and deploy using the ai-net deploy script

```bash
cd smart-contracts

# Build all contracts (outputs to target/wasm32-unknown-unknown/release/)
cargo build --target wasm32-unknown-unknown --release

# Deploy to local standalone node
./scripts/deploy.sh --network standalone
```

Alternatively, deploy a single contract manually:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/agent_registry.wasm \
  --network standalone \
  --source alice
```

The command prints the deployed contract ID. Export it for subsequent calls:

```bash
export CONTRACT_ID=<printed-contract-id>
```

### Verify the deployment

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network standalone \
  --source alice \
  -- \
  contract_version
```

A successful response returns the version string (e.g. `"1.0.0"`), confirming the contract is live and callable.

---

## 3. Contract Structure Conventions

Every contract in `contracts/` follows the same five-file layout. Use `agent_registry` as the reference implementation.

```
contracts/<contract_name>/
├── Cargo.toml
└── src/
    ├── lib.rs        # Entry points: #[contract], #[contractimpl], public functions
    ├── types.rs      # All #[contracttype] enums and structs
    ├── events.rs     # Event structs and publish helpers
    ├── errors.rs     # #[contracterror] enum
    └── upgrade.rs    # Admin-gated upgrade() function
```

### `lib.rs` — entry points

Declare the contract struct and implement all public entry points here. Keep this file focused on function signatures, authorization checks, and dispatch; push data types and logic into the other modules.

```rust
#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

pub mod errors;
pub mod events;
pub mod types;
pub mod upgrade;

pub use errors::Error;
pub use types::*;

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        // ...
    }
}
```

### `types.rs` — data types

All storage-persisted types must derive `#[contracttype]`.

```rust
use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentRecord {
    pub id: Symbol,
    pub owner: Address,
    pub price_stroops: i128,
}

/// Storage key enum — one variant per logical record type.
#[contracttype]
pub enum DataKey {
    Admin,
    Agent(Symbol),
    CapabilityIndex(Symbol),
}
```

Storage keys are always typed `Symbol` or a `DataKey` enum variant — never raw strings — so the compiler catches key typos at build time.

### `events.rs` — events

Each event is a typed struct. Topic convention: `("registry", "<action>")`.

```rust
use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentRegisteredEvent {
    pub agent_id: Symbol,
    pub owner: Address,
    pub capability: Symbol,
    pub price_stroops: i128,
}
```

Emit events via:

```rust
env.events().publish(
    (symbol_short!("registry"), symbol_short!("registered")),
    AgentRegisteredEvent { agent_id, owner, capability, price_stroops },
);
```

### `errors.rs` — error codes

```rust
use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound        = 1,
    Unauthorized    = 2,
    AlreadyExists   = 3,
    ContractPaused  = 4,
    // Add new variants with the next sequential u32
}
```

Error codes must be stable across deploys. Never renumber or remove a variant; mark deprecated ones with a comment instead.

### `upgrade.rs` — admin-gated upgrade

See [Section 7](#7-upgradeability-patterns) for the full upgrade pattern.

---

## 4. Testing Patterns

All contract tests live in a `#[cfg(test)]` module, typically in `src/test.rs`, imported from `lib.rs` with `#[cfg(test)] mod test;`.

Cargo test command:

```bash
cd smart-contracts
cargo test -- --nocapture
```

### The `setup()` helper

Every test file should have a `setup()` function that creates a fresh in-memory environment. This mirrors the pattern used in `agent_registry/src/test.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup() -> (Env, MyContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();                          // bypass auth for most tests
        let id = env.register(MyContract, ());
        let client = MyContractClient::new(&env, &id);
        (env, client)
    }

    fn setup_with_admin() -> (Env, MyContractClient<'static>, Address) {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }
}
```

`env.mock_all_auths()` causes the host to approve every `require_auth()` call automatically. Use it for the majority of unit tests where authorization logic is not under test.

### Full MockAuth example

When you need to assert that a specific caller was authorized — and not just that the call succeeded — use `env.set_auths()` with an explicit `AuthorizedInvocation`:

```rust
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    xdr::{ContractExecutable, InvokeContractArgs, ScAddress, ScVal, StringM},
    Address, Env, IntoVal, Symbol,
};

#[test]
fn only_owner_can_deregister() {
    let env = Env::default();
    // Do NOT call env.mock_all_auths() — we want real auth checking.
    let contract_id = env.register(MyContract, ());
    let client = MyContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);

    // Authorize only the initialize call.
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(&admin);

    // Authorize only the register call as owner.
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "register_agent",
            args: (record.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.register_agent(&record);

    // A different address attempting deregister must panic.
    let attacker = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "deregister_agent",
            args: (agent_id.clone(), attacker.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = client.try_deregister_agent(&agent_id, &attacker);
    assert!(result.is_err(), "attacker should not be able to deregister");
}
```

### Testing time-dependent logic

Soroban's `Ledger` testutils let you set the ledger timestamp and sequence before invoking contract functions:

```rust
#[test]
fn bond_cooldown_enforced() {
    let (env, client, _admin) = setup_with_admin();
    let owner = Address::generate(&env);

    // Set a known timestamp before registration.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000;
    });
    client.register_agent(&make_record(&env, "agent1", "research", owner.clone()));

    // Advance time by less than the 24-hour cooldown.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000 + 3_600; // only 1 hour later
    });
    let result = client.try_return_bond(&Symbol::new(&env, "agent1"), &owner);
    assert_eq!(
        result.unwrap_err().unwrap(),
        Error::CooldownNotElapsed
    );

    // Advance past the cooldown.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000 + 86_401; // just over 24 hours
    });
    assert!(client.try_return_bond(&Symbol::new(&env, "agent1"), &owner).is_ok());
}
```

---

## 5. Deployment Workflow

### Build before deploying

```bash
cd smart-contracts
cargo build --target wasm32-unknown-unknown --release

# Optional: minimize binary size
wasm-opt -Oz \
  target/wasm32-unknown-unknown/release/agent_registry.wasm \
  -o target/wasm32-unknown-unknown/release/agent_registry.opt.wasm
```

### Local standalone

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/agent_registry.wasm \
  --network standalone \
  --source alice
```

### Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/agent_registry.wasm \
  --network testnet \
  --source SXXX_YOUR_TESTNET_SECRET_KEY
```

### Mainnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/agent_registry.wasm \
  --network mainnet \
  --source SXXX_YOUR_MAINNET_SECRET_KEY
```

Mainnet deployments require governance approval first; see [Section 7](#7-upgradeability-patterns).

### Managing contract IDs

Store deployed contract IDs in the `deployments/` directory at the workspace root, one file per network:

```
deployments/
├── standalone.json
├── testnet.json
└── mainnet.json
```

Each file follows the structure:

```json
{
  "agent_registry": "CXXX...",
  "error_resolver": "CYYY...",
  "agent_governance": "CZZZ..."
}
```

Commit `testnet.json` and `mainnet.json` to version control. Regenerate `standalone.json` locally; do not commit it.

### Upgrade path

After deploying a new WASM binary and noting its hash, invoke the upgrade entry point:

```bash
# Install the new WASM to the network and get its hash
stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/agent_registry.opt.wasm \
  --network testnet \
  --source SXXX

# The command prints the WASM hash. Export it:
export HASH=<printed-wasm-hash>

# Invoke the upgrade function on the live contract
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  --source SXXX \
  -- \
  upgrade \
  --new_wasm_hash "$HASH" \
  --new_version "1.1.0"
```

---

## 6. Gas Optimization Tips

Soroban charges CPU instructions as Compute Units (CU). The `agent_registry` contract documents its own cost model in `lib.rs`:

| Operation | Single call | Batch of 10 | Saving vs 10 separate |
|---|---|---|---|
| `register_agent(s)` | ~82,000 CU | ~464,500 CU | ~355,500 CU (~43%) |
| `resolve_error(s)` | ~42,000 CU | ~240,000 CU | ~180,000 CU (~43%) |

The fixed per-transaction overhead (~40,000 CU) is paid once per batch, not per item.

### Use batch operations

Prefer `register_agents` over calling `register_agent` in a loop. The batch validates all items before writing any storage, so the authorization and footprint overhead is paid once.

```rust
// BAD — 10 separate invocations, 10x per-tx overhead
for record in records { client.register_agent(&record); }

// GOOD — single invocation, shared overhead
client.register_agents(&soroban_sdk::Vec::from_slice(&env, &records));
```

### Choose the right storage tier

| Tier | Use for | TTL behavior |
|---|---|---|
| `Instance` | Singleton contract config (admin address, pause flag, gas config) | Extends automatically with every contract invocation |
| `Persistent` | Long-lived entity records (agent records, capability indexes) | Must be extended manually; survives ledger closes |
| `Temporary` | Short-lived session data (caches, rate-limit windows) | Expires automatically; cheap but ephemeral |

### Extend TTL proactively

Extend `Persistent` entries when you write them, not reactively after expiry (see [Section 8](#8-common-soroban-pitfalls) for the pitfall this avoids):

```rust
let key = DataKey::Agent(id.clone());
env.storage().persistent().set(&key, &record);
env.storage().persistent().extend_ttl(&key, 100_000, 100_000);
```

### Minimize WASM binary size

The release profile in `Cargo.toml` already sets `opt-level = "z"` and `lto = true`. After building, run `wasm-opt -Oz` to squeeze out further size:

```bash
wasm-opt -Oz \
  target/wasm32-unknown-unknown/release/agent_registry.wasm \
  -o target/wasm32-unknown-unknown/release/agent_registry.opt.wasm
```

### Avoid unbounded `Vec` in storage

Storing a `Vec` that grows without bound inflates the read/write footprint for every invocation that touches it. Instead, store items individually under keyed entries and maintain a bounded index with a pagination cursor:

```rust
// BAD — Vec grows indefinitely; every lookup reads the entire list
env.storage().persistent().set(&DataKey::AllAgents, &agents_vec);

// GOOD — bounded capability index with cursor-based pagination
let key = DataKey::CapabilityIndex(capability.clone());
// enforce MAX_CAPABILITY_INDEX_SIZE before pushing
env.storage().persistent().set(&key, &bounded_vec);
```

### Cache repeated storage reads

Calling `env.storage().get()` multiple times for the same key inside a single function costs CU each time. Read once and bind to a local variable:

```rust
// BAD — reads storage twice
if env.storage().persistent().get::<_, AgentRecord>(&key).is_some() {
    let record = env.storage().persistent().get::<_, AgentRecord>(&key).unwrap();
    // ...
}

// GOOD — read once
let record: AgentRecord = env.storage().persistent()
    .get(&key)
    .ok_or(Error::NotFound)?;
```

---

## 7. Upgradeability Patterns

### Admin-gated `upgrade()` in `upgrade.rs`

Each contract exposes an admin-only `upgrade()` function that atomically swaps the WASM and records the new version. The core signature from `agent_registry/src/upgrade.rs`:

```rust
pub fn upgrade(
    env: Env,
    new_wasm_hash: BytesN<32>,
    new_version: String,
) -> Result<(), Error> {
    let admin = require_admin(&env)?;      // panics if caller ≠ admin
    let old_version = Self::contract_version(env.clone());

    env.deployer()
        .update_current_contract_wasm(new_wasm_hash.clone());

    env.storage().instance().set(
        &DataKey::Agent(Symbol::new(&env, "version")),
        &new_version,
    );
    env.storage().instance().set(
        &DataKey::Agent(Symbol::new(&env, "last_upgrade")),
        &env.ledger().sequence(),
    );

    env.events().publish(
        (symbol_short!("registry"), symbol_short!("upgraded")),
        ContractUpgradedEvent {
            old_version,
            new_version,
            wasm_hash: new_wasm_hash,
            admin,
            upgrade_ledger: env.ledger().sequence(),
        },
    );

    Ok(())
}
```

`require_admin` reads the `Admin` key from `Instance` storage and calls `admin.require_auth()`, so the transaction must be signed by the stored admin address.

### Testing upgrades

Use `env.register` to deploy two versions in the same test environment and confirm that the post-upgrade state is correct:

```rust
#[test]
fn upgrade_changes_version() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy v1
    let id = env.register(AgentRegistryContract, ());
    let client = AgentRegistryContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    assert_eq!(client.contract_version(), String::from_str(&env, "1.0.0"));

    // Install v2 WASM (in tests, re-register returns the same address with new code)
    let v2_hash = env.deployer().upload_contract_wasm(AgentRegistryContractV2::wasm());

    client.upgrade(&v2_hash, &String::from_str(&env, "2.0.0"));

    // After upgrade, version reflects new value
    assert_eq!(client.contract_version(), String::from_str(&env, "2.0.0"));
}
```

### Governance approval for mainnet upgrades

Mainnet upgrades must be proposed through the `agent_governance` contract and approved by the multisig before `upgrade()` can be invoked.

The default timelock delay is **86,400 seconds (24 hours)**, defined in `lib.rs`:

```rust
pub const DEFAULT_TIMELOCK_DELAY: u64 = 86_400;
```

Upgrade flow on mainnet:

1. Propose the upgrade via `agent_governance.propose_action(AdminAction::Upgrade(...))`.
2. Collect multisig approvals (threshold M of N signers).
3. Wait for the 24-hour timelock to elapse.
4. Execute: `agent_governance.execute_proposal(proposal_id)`, which calls `upgrade()` on the target contract.

Never call `upgrade()` directly on mainnet from a single-signer account.

---

## 8. Common Soroban Pitfalls

### 1. Storage TTL expiry

**The problem:** `Persistent` storage entries have a TTL. If you do not extend it, the entry disappears silently — no error is returned; reads simply return `None`. This is one of the most common sources of "data vanishing" bugs in production.

```rust
// BAD — entry is written but TTL is never extended;
// it will expire and future lookups will return None
env.storage().persistent().set(&DataKey::Agent(id.clone()), &record);
```

```rust
// GOOD — extend TTL immediately on write
env.storage().persistent().set(&DataKey::Agent(id.clone()), &record);
env.storage().persistent().extend_ttl(
    &DataKey::Agent(id.clone()),
    100_000,  // min TTL (ledgers): extend if current TTL is below this
    100_000,  // target TTL (ledgers): extend to this value
);
```

For `Instance` storage (singleton config), extend TTL on every invocation that reads config:

```rust
env.storage().instance().extend_ttl(100, 100);
```

### 2. Auth context not propagated to sub-calls

**The problem:** When contract A calls contract B, contract B cannot see contract A's incoming authorizations. If contract B calls `addr.require_auth()`, it fails unless the original transaction included an authorization specifically scoped to contract B's invocation.

```rust
// BAD — calling a sub-contract and assuming auth transfers automatically
let escrow = EscrowContractClient::new(&env, &escrow_id);
escrow.release_payment(&recipient, &amount);  // will panic: no auth for escrow
```

```rust
// GOOD — pass the current contract address so the sub-contract can verify it,
// and ensure the invoker included sub-invocation auth in the transaction
recipient.require_auth();  // authorize in this contract's scope
let escrow = EscrowContractClient::new(&env, &escrow_id);
// The transaction's auth tree must include an AuthorizedInvocation for escrow
escrow.release_payment(&recipient, &amount);
```

When testing cross-contract calls, provide nested `sub_invokes` in your `MockAuth`:

```rust
env.mock_auths(&[MockAuth {
    address: &caller,
    invoke: &MockAuthInvoke {
        contract: &registry_id,
        fn_name: "compound_action",
        args: (...).into_val(&env),
        sub_invokes: &[MockAuthInvoke {
            contract: &escrow_id,
            fn_name: "release_payment",
            args: (...).into_val(&env),
            sub_invokes: &[],
        }],
    },
}]);
```

### 3. Integer overflow in XLM/stroop arithmetic

**The problem:** Stroop amounts are `i128`. Multiplying two `i128` values without overflow checks can silently wrap around, corrupting payment amounts.

```rust
// BAD — multiplication can overflow for large values
let total = price_stroops * quantity as i128;
```

```rust
// GOOD — use checked arithmetic; return an error on overflow
let total = price_stroops
    .checked_mul(quantity as i128)
    .ok_or(Error::Overflow)?;
```

The release profile already sets `overflow-checks = true`, which turns arithmetic overflows into panics in debug builds. Use `checked_*` methods in production paths so you can return a typed error instead of aborting the transaction.

### 4. Host function cost limits (unbounded loops)

**The problem:** Soroban enforces a per-transaction CU budget. Iterating over unbounded data in a single invocation will exceed the budget and abort the transaction with a resource-limit error.

```rust
// BAD — iterates the entire registry; fails when agent count is large
pub fn get_all_agents(env: Env) -> Vec<AgentRecord> {
    let all_ids: Vec<Symbol> = env.storage().persistent().get(&DataKey::AllAgents).unwrap();
    all_ids.iter().map(|id| {
        env.storage().persistent().get(&DataKey::Agent(id)).unwrap()
    }).collect()
}
```

```rust
// GOOD — paginate with a cursor; each call fetches a bounded page
pub fn list_agents(env: Env, cursor: Option<u64>, limit: u32) -> (Vec<AgentRecord>, Option<u64>) {
    let limit = limit.min(MAX_PAGE_SIZE);
    // read only `limit` records starting from cursor position
    // return next_cursor = None when the last page is reached
}
```

The `cursor.ts` module in the backend and the `DataKey::CapabilityIndex` pattern in `agent_registry` are the reference implementations for this pattern.

### 5. Footprint declaration

**The problem:** Every storage key a transaction reads or writes must be declared in the transaction's footprint before submission. Keys not in the footprint cause the transaction to fail at the simulation or preflight step, not at runtime — which makes the error appear to come from client-side simulation rather than the contract.

```rust
// BAD — dynamically computing storage keys from user input at runtime
// means the preflight simulation cannot predict the footprint
let key = DataKey::Agent(Symbol::new(&env, &user_supplied_id_string));
env.storage().persistent().get(&key)
```

```rust
// GOOD — keep storage keys deterministic and derivable from the
// transaction's explicit arguments so preflight can enumerate them
pub fn get_agent(env: Env, agent_id: Symbol) -> Option<AgentRecord> {
    // `agent_id` is an explicit argument; preflight knows the key
    env.storage().persistent().get(&DataKey::Agent(agent_id))
}
```

When writing integration tests that call the real Soroban RPC (not the in-process `Env`), always run `stellar contract simulate` before submitting to catch footprint mismatches early:

```bash
stellar contract simulate \
  --id "$CONTRACT_ID" \
  --network testnet \
  --source alice \
  -- get_agent --agent_id my_agent
```
