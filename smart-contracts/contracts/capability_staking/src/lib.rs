#![no_std]
#![allow(clippy::too_many_arguments)]

//! # Capability Staking Contract
//!
//! Dedicated on-chain staking mechanism for agent capabilities on the ai-net
//! Stellar network. Agents stake XLM bonds against individual capabilities to
//! signal commitment and gain listing eligibility. Bonds pass through a 7-day
//! unbonding period before being claimable, and can be slashed by the admin for
//! misbehaviour, with slashed funds routed to a treasury address.
//!
//! ## Flow
//!
//! 1. **`initialize`** — one-time setup of admin and treasury addresses.
//! 2. **`set_min_stake`** — admin configures minimum stake per capability.
//! 3. **`stake_bond`** — agent owner locks XLM against a capability.
//!    Amount must be >= `get_min_stake(capability)`.
//! 4. **`unstake_bond`** — initiates 7-day unbonding period.
//! 5. **`claim_unbonded`** — after 7 days the agent retrieves its stake.
//! 6. **`slash_bond`** — admin slashes the entire remaining stake for
//!    misbehaviour, routing the slashed amount to the treasury.
//!
//! ## Storage Layout
//!
//! | Key                              | Type                    | Scope      |
//! |----------------------------------|-------------------------|------------|
//! | `Admin`                          | `Address`               | Instance   |
//! | `TreasuryAddress`                | `Address`               | Instance   |
//! | `MinStakePerCapability(cap)`     | `i128`                  | Persistent |
//! | `StakeRecord(agent_id, cap)`     | `StakeRecord`           | Persistent |
//! | `UnbondingRecord(agent_id, cap)` | `UnbondingRecord`       | Persistent |
//!
//! ## Event Catalogue
//!
//! | Function          | Topics                         | Data               |
//! |-------------------|--------------------------------|--------------------|
//! | `stake_bond`      | `(staking, staked)`            | `BondStakedEvent`  |
//! | `unstake_bond`    | `(staking, unstaked)`          | `BondUnstakedEvent`|
//! | `slash_bond`      | `(staking, slashed)`           | `BondSlashedEvent` |
//! | `claim_unbonded`  | `(staking, claimed)`           | `BondClaimedEvent` |

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env, Symbol, Vec,
};

// ─── Constants ───────────────────────────────────────────────────────────────

/// 7 days at ~5s per ledger: 7 * 24 * 3600 / 5 = 120_960 ledgers.
pub const UNBONDING_PERIOD_LEDGERS: u32 = 120_960;

/// 30 ledger-days blacklist period: 30 * 24 * 3600 / 5 = 518_400 ledgers.
pub const BLACKLIST_PERIOD_LEDGERS: u32 = 518_400;

/// Default minimum stake per capability: 10 XLM in stroops.
pub const DEFAULT_MIN_STAKE_STROOPS: i128 = 100_000_000;

/// TTL threshold (ledgers remaining) below which we extend instance storage.
const TTL_THRESHOLD: u32 = 100_000;

/// Target TTL after extension (~31 days at 5s per ledger).
const TTL_EXTEND_TO: u32 = 535_680;

// ─── Storage Keys ────────────────────────────────────────────────────────────

/// Storage key discriminants for all on-chain state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// The governance / admin address.
    Admin,
    /// Destination for slashed funds.
    TreasuryAddress,
    /// The dispute_resolution contract address — the only caller allowed to invoke `slash`.
    DisputeResolutionContract,
    /// The XLM/native token contract address used for treasury transfers.
    TokenContract,
    /// Per-capability minimum stake override. Key = capability `Symbol`.
    MinStakePerCapability(Symbol),
    /// Active stake record keyed by (agent_id, capability).
    StakeRecord(Symbol, Symbol),
    /// Unbonding record keyed by (agent_id, capability).
    UnbondingRecord(Symbol, Symbol),
    /// Blacklist record keyed by agent Address. Value = ledger seq at which ban expires.
    Blacklist(Address),
    /// Address+Bytes keyed stake record for the new slash() path.
    AddressStakeRecord(Address, Bytes),
    VotingStakeEnabled,
    ActiveBondOwner(Symbol, Symbol),
    ActiveBondId(Address, Symbol),
    UnbondingOwner(Symbol, Symbol),
    StakeHistory(Address),
    TotalStakeHistory,
}

// ─── Data Types ──────────────────────────────────────────────────────────────

const MAX_STAKE_CHECKPOINTS: u32 = 100;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeCheckpoint {
    pub ledger: u32,
    pub balance: i128,
}

/// On-chain record for an active stake bond.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeRecord {
    /// Identifier of the staking agent.
    pub agent_id: Symbol,
    /// The capability being staked against.
    pub capability: Symbol,
    /// Staked amount in stroops.
    pub amount_stroops: i128,
    /// Ledger sequence number at which the stake was created.
    pub staked_at: u64,
    /// Set to the ledger sequence when unbonding was initiated.
    pub unbonding_since: Option<u64>,
}

/// On-chain record created when an agent begins the unbonding process.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnbondingRecord {
    /// Identifier of the staking agent.
    pub agent_id: Symbol,
    /// The capability whose stake is unbonding.
    pub capability: Symbol,
    /// The amount that will be claimable after the unbonding period.
    pub amount_stroops: i128,
    /// Ledger sequence number at which unbonding was initiated.
    pub unbonding_since: u64,
    /// Ledger sequence number after which the stake can be claimed.
    pub claimable_at: u64,
}

// ─── Event Payloads ──────────────────────────────────────────────────────────

/// Emitted by `stake_bond` when a bond is successfully created or topped up.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BondStakedEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub amount_stroops: i128,
}

/// Emitted by `unstake_bond` when a bond enters the unbonding period.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BondUnstakedEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub amount_stroops: i128,
    /// The ledger sequence number after which the stake can be claimed.
    pub claimable_at: u64,
}

/// Emitted by `slash_bond` when an admin slashes an agent's stake.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BondSlashedEvent {
    pub agent_id: Symbol,
    /// Human-readable reason for the slash action.
    pub reason: Symbol,
    /// The total amount that was slashed in stroops.
    pub amount_stroops: i128,
    /// Treasury address that received the slashed funds.
    pub treasury: Address,
}

/// Emitted by `slash` when dispute_resolution slashes a specific capability bond.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilitySlashedEvent {
    pub agent_id: Address,
    pub capability: Bytes,
    pub slash_amount: i128,
    pub remaining_stake: i128,
    /// Ledger sequence at which the slash was executed.
    pub ledger: u32,
}

/// Emitted by `claim_unbonded` when an unbonded stake is successfully claimed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BondClaimedEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub amount_stroops: i128,
}

/// On-chain record for an active Address-keyed stake bond (used by `slash`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AddressStakeRecord {
    pub agent_id: Address,
    pub capability: Bytes,
    pub amount_stroops: i128,
    pub staked_at: u32,
}

// ─── Error Codes ─────────────────────────────────────────────────────────────

/// Contract error discriminants, returned via `panic_with_error!` / panic.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Contract has already been initialised.
    AlreadyInitialized = 1,
    /// Contract has not been initialised yet.
    NotInitialized = 2,
    /// The supplied stake amount is below the per-capability minimum.
    StakeBelowMinimum = 3,
    /// No active stake record exists for this (agent, capability) pair.
    StakeNotFound = 4,
    /// No unbonding record exists for this (agent, capability) pair.
    UnbondingNotFound = 5,
    /// Unbonding period has not elapsed; claim is not yet available.
    UnbondingPeriodNotElapsed = 6,
    /// Only the contract admin may call this function.
    Unauthorized = 7,
    /// Only the dispute_resolution contract may call `slash`.
    CallerNotDisputeResolution = 8,
    /// The slash amount must be positive.
    InvalidSlashAmount = 9,
    /// Agent is currently blacklisted and may not stake.
    AgentBlacklisted = 10,
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

fn append_checkpoint(history: &mut Vec<StakeCheckpoint>, ledger: u32, delta: i128) {
    let balance = history
        .back()
        .map_or(0, |entry| entry.balance)
        .checked_add(delta)
        .expect("stake balance overflow");
    let entry = StakeCheckpoint { ledger, balance };
    if history.back().is_some_and(|latest| latest.ledger == ledger) {
        history.set(history.len() - 1, entry);
    } else {
        if history.len() == MAX_STAKE_CHECKPOINTS {
            history.pop_front();
        }
        history.push_back(entry);
    }
}

fn record_stake_change(env: &Env, owner: &Address, delta: i128) {
    let key = DataKey::StakeHistory(owner.clone());
    let storage = env.storage().persistent();
    let mut history = storage.get(&key).unwrap_or_else(|| Vec::new(env));
    let instance = env.storage().instance();
    let mut total = instance
        .get(&DataKey::TotalStakeHistory)
        .unwrap_or_else(|| Vec::new(env));
    // Use balances entering the proposal ledger. Stake acquired later in that
    // same ledger must be ineligible even if the proposal is voted on later.
    let effective_ledger = env
        .ledger()
        .sequence()
        .checked_add(1)
        .expect("ledger sequence overflow");
    append_checkpoint(&mut history, effective_ledger, delta);
    append_checkpoint(&mut total, effective_ledger, delta);
    storage.set(&key, &history);
    extend_persistent_ttl(env, &key);
    instance.set(&DataKey::TotalStakeHistory, &total);
}

fn balance_at(history: &Vec<StakeCheckpoint>, ledger: u32) -> i128 {
    let mut low = 0;
    let mut high = history.len();
    while low < high {
        let mid = low + (high - low) / 2;
        if history.get(mid).unwrap().ledger <= ledger {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    low.checked_sub(1)
        .and_then(|index| history.get(index))
        .map_or(0, |entry| entry.balance)
}

fn funded_bond_for(env: &Env, owner: &Address, capability: &Bytes) -> Option<(Symbol, Symbol)> {
    let mut buffer = [0; 32];
    let bytes = buffer.get_mut(..capability.len() as usize)?;
    capability.copy_into_slice(bytes);
    if bytes.is_empty()
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        return None;
    }
    let name = core::str::from_utf8(bytes).ok()?;
    let symbol = Symbol::new(env, name);
    let id = env
        .storage()
        .persistent()
        .get(&DataKey::ActiveBondId(owner.clone(), symbol.clone()))?;
    Some((id, symbol))
}

fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn load_treasury(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TreasuryAddress)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn load_dispute_resolution(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::DisputeResolutionContract)
        .unwrap_or_else(|| panic!("dispute_resolution contract not configured"))
}

fn load_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenContract)
        .unwrap_or_else(|| panic!("token contract not configured"))
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct CapabilityStakingContract;

#[contractimpl]
impl CapabilityStakingContract {
    // ── Initialisation ──────────────────────────────────────────────────────

    /// One-time initialisation. Sets the admin, treasury, and token addresses.
    ///
    /// # Authorization
    /// Requires auth from `admin`.
    ///
    /// # Errors
    /// Panics with `Error::AlreadyInitialized` if called more than once.
    pub fn initialize(env: Env, admin: Address, treasury: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TreasuryAddress, &treasury);
        env.storage()
            .instance()
            .set(&DataKey::TokenContract, &token);
        extend_instance_ttl(&env);
    }

    /// New bonds will be token-backed and eligible for governance voting.
    /// Existing event-based bonds remain claimable through their original flow.
    pub fn enable_voting_stake(env: Env) {
        load_admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VotingStakeEnabled, &true);
        extend_instance_ttl(&env);
    }

    pub fn get_voting_power_at(env: Env, voter: Address, ledger: u32) -> i128 {
        let history = env
            .storage()
            .persistent()
            .get(&DataKey::StakeHistory(voter))
            .unwrap_or_else(|| Vec::new(&env));
        balance_at(&history, ledger)
    }

    pub fn get_total_voting_power_at(env: Env, ledger: u32) -> i128 {
        let history = env
            .storage()
            .instance()
            .get(&DataKey::TotalStakeHistory)
            .unwrap_or_else(|| Vec::new(&env));
        balance_at(&history, ledger)
    }

    /// Admin: set the dispute_resolution contract address that is permitted to
    /// call `slash`. This can be called after deployment once the
    /// dispute_resolution contract is deployed.
    ///
    /// # Authorization
    /// Admin only.
    pub fn set_dispute_resolution(env: Env, contract_id: Address) {
        let admin = load_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::DisputeResolutionContract, &contract_id);
        extend_instance_ttl(&env);
    }

    // ── Configuration ───────────────────────────────────────────────────────

    /// Override the minimum stake required for a specific capability.
    ///
    /// # Authorization
    /// Admin only.
    pub fn set_min_stake(env: Env, capability: Symbol, amount: i128) {
        let admin = load_admin(&env);
        admin.require_auth();

        let key = DataKey::MinStakePerCapability(capability);
        env.storage().persistent().set(&key, &amount);
        extend_persistent_ttl(&env, &key);
        extend_instance_ttl(&env);
    }

    /// Returns the configured minimum stake for `capability`, or
    /// [`DEFAULT_MIN_STAKE_STROOPS`] if no override has been set.
    pub fn get_min_stake(env: Env, capability: Symbol) -> i128 {
        extend_instance_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::MinStakePerCapability(capability))
            .unwrap_or(DEFAULT_MIN_STAKE_STROOPS)
    }

    // ── Staking ─────────────────────────────────────────────────────────────

    /// Lock a stake bond against a capability.
    ///
    /// The `agent_id` is the on-chain identifier for the agent and the caller
    /// must authenticate as the owner associated with `agent_id`. In this
    /// contract the owner is tracked implicitly — the transaction signer must
    /// `require_auth` via the `agent_id`'s controlling `Address`. Here we
    /// require an explicit `owner` address parameter so the caller can prove
    /// ownership.
    ///
    /// # Authorization
    /// `owner` must call `require_auth`.
    ///
    /// # Errors
    /// Panics with `Error::StakeBelowMinimum` if `amount_stroops` is less than
    /// the capability's minimum stake.
    pub fn stake_bond(
        env: Env,
        owner: Address,
        agent_id: Symbol,
        capability: Symbol,
        amount_stroops: i128,
    ) {
        owner.require_auth();

        // Validate amount meets minimum.
        let min_stake = env
            .storage()
            .persistent()
            .get(&DataKey::MinStakePerCapability(capability.clone()))
            .unwrap_or(DEFAULT_MIN_STAKE_STROOPS);

        if amount_stroops < min_stake {
            panic!("stake below minimum");
        }

        let key = DataKey::StakeRecord(agent_id.clone(), capability.clone());
        let storage = env.storage().persistent();
        if env.storage().instance().has(&DataKey::VotingStakeEnabled) {
            if amount_stroops <= 0 {
                panic!("stake must be positive");
            }
            let id_key = DataKey::ActiveBondId(owner.clone(), capability.clone());
            if storage.has(&key) || storage.has(&id_key) {
                panic!("stake already exists");
            }
            token::Client::new(&env, &load_token(&env)).transfer(
                &owner,
                &env.current_contract_address(),
                &amount_stroops,
            );
            let owner_key = DataKey::ActiveBondOwner(agent_id.clone(), capability.clone());
            storage.set(&owner_key, &owner);
            storage.set(&id_key, &agent_id);
            extend_persistent_ttl(&env, &owner_key);
            extend_persistent_ttl(&env, &id_key);
            record_stake_change(&env, &owner, amount_stroops);
        }

        let ledger_seq = env.ledger().sequence() as u64;
        let record = StakeRecord {
            agent_id: agent_id.clone(),
            capability: capability.clone(),
            amount_stroops,
            staked_at: ledger_seq,
            unbonding_since: None,
        };

        env.storage().persistent().set(&key, &record);
        extend_persistent_ttl(&env, &key);
        extend_instance_ttl(&env);

        // Emit event.
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("staked")),
            BondStakedEvent {
                agent_id,
                capability,
                amount_stroops,
            },
        );
    }

    /// Initiate the 7-day unbonding period for an active stake.
    ///
    /// Removes the active `StakeRecord` and creates an `UnbondingRecord` with
    /// `claimable_at = current_ledger + UNBONDING_PERIOD_LEDGERS`.
    ///
    /// # Authorization
    /// `owner` must call `require_auth`.
    ///
    /// # Errors
    /// Panics with `Error::StakeNotFound` if no active stake exists.
    pub fn unstake_bond(env: Env, owner: Address, agent_id: Symbol, capability: Symbol) {
        owner.require_auth();

        let stake_key = DataKey::StakeRecord(agent_id.clone(), capability.clone());
        let record: StakeRecord = env
            .storage()
            .persistent()
            .get(&stake_key)
            .unwrap_or_else(|| panic!("stake not found"));

        let storage = env.storage().persistent();
        let owner_key = DataKey::ActiveBondOwner(agent_id.clone(), capability.clone());
        let unbonding_owner_key = DataKey::UnbondingOwner(agent_id.clone(), capability.clone());
        let unbonding_key = DataKey::UnbondingRecord(agent_id.clone(), capability.clone());
        if storage.has(&unbonding_owner_key) {
            panic!("unbonding already exists");
        }
        if let Some(bond_owner) = storage.get::<_, Address>(&owner_key) {
            if owner != bond_owner {
                panic!("wrong bond owner");
            }
            if storage.has(&unbonding_key) {
                panic!("unbonding already exists");
            }
            record_stake_change(&env, &owner, -record.amount_stroops);
            storage.remove(&owner_key);
            storage.remove(&DataKey::ActiveBondId(owner.clone(), capability.clone()));
            storage.set(&unbonding_owner_key, &owner);
            extend_persistent_ttl(&env, &unbonding_owner_key);
        }

        // Remove the active stake record.
        env.storage().persistent().remove(&stake_key);

        let current_ledger = env.ledger().sequence() as u64;
        let claimable_at = current_ledger + (UNBONDING_PERIOD_LEDGERS as u64);

        let unbonding = UnbondingRecord {
            agent_id: agent_id.clone(),
            capability: capability.clone(),
            amount_stroops: record.amount_stroops,
            unbonding_since: current_ledger,
            claimable_at,
        };

        env.storage().persistent().set(&unbonding_key, &unbonding);
        extend_persistent_ttl(&env, &unbonding_key);
        extend_instance_ttl(&env);

        // Emit event.
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("unstaked")),
            BondUnstakedEvent {
                agent_id,
                capability,
                amount_stroops: record.amount_stroops,
                claimable_at,
            },
        );
    }

    /// Claim an unbonded stake after the 7-day unbonding period has elapsed.
    ///
    /// Removes the `UnbondingRecord` and emits a `BondClaimedEvent`. In a full
    /// deployment the XLM transfer would be executed here; this contract tracks
    /// the lifecycle and leaves the transfer to the caller to execute against
    /// Stellar's native token contract.
    ///
    /// # Authorization
    /// `owner` must call `require_auth`.
    ///
    /// # Errors
    /// - Panics with `Error::UnbondingNotFound` if no unbonding record exists.
    /// - Panics with `Error::UnbondingPeriodNotElapsed` if the waiting period
    ///   has not yet passed.
    pub fn claim_unbonded(env: Env, owner: Address, agent_id: Symbol, capability: Symbol) {
        owner.require_auth();

        let unbonding_key = DataKey::UnbondingRecord(agent_id.clone(), capability.clone());
        let record: UnbondingRecord = env
            .storage()
            .persistent()
            .get(&unbonding_key)
            .unwrap_or_else(|| panic!("unbonding not found"));

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < record.claimable_at {
            panic!("unbonding period not elapsed");
        }

        let owner_key = DataKey::UnbondingOwner(agent_id.clone(), capability.clone());
        let storage = env.storage().persistent();
        if let Some(bond_owner) = storage.get::<_, Address>(&owner_key) {
            if owner != bond_owner {
                panic!("wrong bond owner");
            }
            storage.remove(&owner_key);
            token::Client::new(&env, &load_token(&env)).transfer(
                &env.current_contract_address(),
                &owner,
                &record.amount_stroops,
            );
        }

        // Remove the unbonding record — stake is considered claimed.
        env.storage().persistent().remove(&unbonding_key);
        extend_instance_ttl(&env);

        // Emit event.
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("claimed")),
            BondClaimedEvent {
                agent_id,
                capability,
                amount_stroops: record.amount_stroops,
            },
        );
    }

    /// Slash the entire remaining stake for an agent across all capabilities.
    ///
    /// The admin specifies the `agent_id` and a symbolic `reason`. The slashed
    /// amount is read from any active `StakeRecord` or `UnbondingRecord`. Both
    /// records are removed (the bond is permanently forfeited). Slashed funds
    /// are routed to the treasury — signalled via event for off-chain execution.
    ///
    /// # Authorization
    /// Admin only. Panics with `Error::Unauthorized` if caller is not admin.
    ///
    /// # Errors
    /// Panics if neither an active stake nor an unbonding record is found for
    /// the given (agent_id, capability) pair.
    pub fn slash_bond(env: Env, agent_id: Symbol, capability: Symbol, reason: Symbol) {
        let admin = load_admin(&env);
        admin.require_auth();

        let treasury = load_treasury(&env);

        // Attempt to read from active stake first, then unbonding.
        let stake_key = DataKey::StakeRecord(agent_id.clone(), capability.clone());
        let unbonding_key = DataKey::UnbondingRecord(agent_id.clone(), capability.clone());

        let storage = env.storage().persistent();
        let active_owner_key = DataKey::ActiveBondOwner(agent_id.clone(), capability.clone());
        let unbonding_owner_key = DataKey::UnbondingOwner(agent_id.clone(), capability.clone());
        let amount_stroops: i128 = if let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, StakeRecord>(&stake_key)
        {
            storage.remove(&stake_key);
            if let Some(owner) = storage.get::<_, Address>(&active_owner_key) {
                storage.remove(&active_owner_key);
                storage.remove(&DataKey::ActiveBondId(owner.clone(), capability.clone()));
                record_stake_change(&env, &owner, -record.amount_stroops);
                token::Client::new(&env, &load_token(&env)).transfer(
                    &env.current_contract_address(),
                    &treasury,
                    &record.amount_stroops,
                );
            }
            record.amount_stroops
        } else if let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, UnbondingRecord>(&unbonding_key)
        {
            storage.remove(&unbonding_key);
            if storage.has(&unbonding_owner_key) {
                storage.remove(&unbonding_owner_key);
                token::Client::new(&env, &load_token(&env)).transfer(
                    &env.current_contract_address(),
                    &treasury,
                    &record.amount_stroops,
                );
            }
            record.amount_stroops
        } else {
            panic!("stake not found");
        };

        extend_instance_ttl(&env);

        // Emit slashed event — off-chain listener transfers funds to treasury.
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("slashed")),
            BondSlashedEvent {
                agent_id,
                reason,
                amount_stroops,
                treasury,
            },
        );
    }

    /// Slash a specific capability bond. May only be called by the configured
    /// dispute_resolution contract (verified via cross-contract caller check).
    ///
    /// Behaviour:
    /// - Deducts `slash_amount` from the agent's active stake for `capability`.
    /// - If `slash_amount >= staked amount`, the full bond is taken, the
    ///   capability stake record is removed, and the agent is blacklisted for
    ///   30 ledger-days (BLACKLIST_PERIOD_LEDGERS).
    /// - Slashed funds are transferred to the treasury via the native token
    ///   contract.
    /// - Emits `capability_slashed { agent_id, capability, slash_amount,
    ///   remaining_stake, ledger }`.
    ///
    /// # Authorization
    /// Caller must be the dispute_resolution contract address stored in
    /// `DataKey::DisputeResolutionContract`. Any other caller panics with
    /// `Error::CallerNotDisputeResolution`.
    ///
    /// # Errors
    /// - Panics with `Error::CallerNotDisputeResolution` when called by anyone
    ///   other than the configured dispute_resolution contract.
    /// - Panics with `Error::InvalidSlashAmount` when `slash_amount <= 0`.
    /// - Panics with `Error::StakeNotFound` when no active stake exists for
    ///   the (agent_id, capability) pair.
    pub fn slash(
        env: Env,
        agent_id: Address,
        capability: Bytes,
        slash_amount: i128,
        reason: Bytes,
    ) {
        // ── Caller verification ──────────────────────────────────────────────
        let dr_contract = load_dispute_resolution(&env);
        // The dispute_resolution contract must authorise this call via
        // `env.current_contract_address()` in its own invocation context.
        // We verify the invoker is the dispute_resolution contract.
        dr_contract.require_auth();

        if slash_amount <= 0 {
            panic!("invalid slash amount");
        }

        let treasury = load_treasury(&env);
        let token_id = load_token(&env);
        let current_ledger = env.ledger().sequence();

        let storage = env.storage().persistent();
        let (actual_slash, remaining) =
            if let Some((id, symbol)) = funded_bond_for(&env, &agent_id, &capability) {
                let key = DataKey::StakeRecord(id.clone(), symbol.clone());
                let mut record: StakeRecord = storage.get(&key).expect("stake not found");
                let actual = slash_amount.min(record.amount_stroops);
                record.amount_stroops -= actual;
                record_stake_change(&env, &agent_id, -actual);
                if record.amount_stroops == 0 {
                    storage.remove(&key);
                    storage.remove(&DataKey::ActiveBondOwner(id, symbol.clone()));
                    storage.remove(&DataKey::ActiveBondId(agent_id.clone(), symbol));
                } else {
                    storage.set(&key, &record);
                }
                (actual, record.amount_stroops)
            } else {
                let key = DataKey::AddressStakeRecord(agent_id.clone(), capability.clone());
                let mut record: AddressStakeRecord = storage.get(&key).expect("stake not found");
                let actual = slash_amount.min(record.amount_stroops);
                record.amount_stroops -= actual;
                if record.amount_stroops == 0 {
                    storage.remove(&key);
                } else {
                    storage.set(&key, &record);
                    extend_persistent_ttl(&env, &key);
                }
                (actual, record.amount_stroops)
            };
        if remaining == 0 {
            let expires = current_ledger.saturating_add(BLACKLIST_PERIOD_LEDGERS);
            let key = DataKey::Blacklist(agent_id.clone());
            storage.set(&key, &expires);
            extend_persistent_ttl(&env, &key);
        }

        // Transfer slashed funds to treasury via the token contract.
        token::Client::new(&env, &token_id).transfer(
            &env.current_contract_address(),
            &treasury,
            &actual_slash,
        );

        extend_instance_ttl(&env);

        // Emit event.
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("cap_slshd")),
            CapabilitySlashedEvent {
                agent_id,
                capability,
                slash_amount: actual_slash,
                remaining_stake: remaining,
                ledger: current_ledger,
            },
        );

        // Suppress unused warning on reason — stored in event for off-chain indexers.
        let _ = reason;
    }

    // ── Queries ─────────────────────────────────────────────────────────────

    /// Returns the active `StakeRecord` for an (agent_id, capability) pair, or
    /// `None` if no stake exists.
    pub fn get_stake(env: Env, agent_id: Symbol, capability: Symbol) -> Option<StakeRecord> {
        extend_instance_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::StakeRecord(agent_id, capability))
    }

    /// Returns the `UnbondingRecord` for an (agent_id, capability) pair, or
    /// `None` if no unbonding is in progress.
    pub fn get_unbonding(
        env: Env,
        agent_id: Symbol,
        capability: Symbol,
    ) -> Option<UnbondingRecord> {
        extend_instance_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::UnbondingRecord(agent_id, capability))
    }

    /// Returns `true` if the agent has an active stake >= the capability's
    /// minimum stake, `false` otherwise (no stake, insufficient stake, or
    /// stake is in the unbonding period).
    pub fn is_sufficiently_staked(env: Env, agent_id: Symbol, capability: Symbol) -> bool {
        extend_instance_ttl(&env);
        let min_stake: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MinStakePerCapability(capability.clone()))
            .unwrap_or(DEFAULT_MIN_STAKE_STROOPS);

        match env
            .storage()
            .persistent()
            .get::<DataKey, StakeRecord>(&DataKey::StakeRecord(agent_id, capability))
        {
            Some(record) => record.amount_stroops >= min_stake,
            None => false,
        }
    }

    /// Returns `true` if `agent_id` is currently blacklisted (i.e. their
    /// blacklist has not yet expired), `false` otherwise.
    pub fn is_blacklisted(env: Env, agent_id: Address) -> bool {
        extend_instance_ttl(&env);
        let key = DataKey::Blacklist(agent_id);
        match env.storage().persistent().get::<DataKey, u32>(&key) {
            Some(expires_at) => env.ledger().sequence() < expires_at,
            None => false,
        }
    }
}

#[cfg(test)]
mod test;
