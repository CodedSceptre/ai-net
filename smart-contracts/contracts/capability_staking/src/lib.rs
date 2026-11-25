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
//! ## Delegation
//!
//! The admin configures the agent registry with `set_registry`. A registered
//! agent owner calls `bind_agent` with its registry ID. Any wallet can deposit
//! token-backed stake with `fund_stake` and move it to a registered owner's
//! pool with `delegate_stake`. A wallet authorizes its own undelegation and
//! claim. Active stake counts toward eligibility and rewards. Unbonding stake
//! stops counting immediately and remains slashable until claimed.
//!
//! A delegation claim credits the caller's own stake balance. To withdraw
//! own stake to the wallet, pass the same address as both arguments to
//! `undelegate_stake` and, after the cooldown, `claim_undelegated`.
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

mod types;

pub use types::{DelegationRecord, StakeDelegated, UndelegationInitiated};

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env,
    IntoVal, Symbol, Vec, I256,
};
use types::PendingUndelegation;

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
    Registry,
    RegisteredAgent(Address),
    Delegations(Address),
    PendingUndelegations(Address),
    OwnStake(Address),
}

// ─── Data Types ──────────────────────────────────────────────────────────────

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
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
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
    InvalidDelegation = 11,
    UnknownDelegatee = 12,
    DelegatorLimitReached = 13,
    UnbondingPeriodActive = 14,
    PendingUndelegationExists = 15,
    ArithmeticOverflow = 16,
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

const MAX_DELEGATORS: u32 = 10;
const DELEGATION_UNBONDING_SECS: u64 = 7 * 24 * 60 * 60;

fn own_stake(env: &Env, address: &Address) -> i128 {
    let key = DataKey::OwnStake(address.clone());
    extend_persistent_ttl(env, &key);
    env.storage().persistent().get(&key).unwrap_or(0)
}

fn delegations(env: &Env, delegatee: &Address) -> Vec<DelegationRecord> {
    let key = DataKey::Delegations(delegatee.clone());
    extend_persistent_ttl(env, &key);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

fn pending(env: &Env, delegatee: &Address) -> Vec<PendingUndelegation> {
    let key = DataKey::PendingUndelegations(delegatee.clone());
    extend_persistent_ttl(env, &key);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

fn save<T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &T) {
    env.storage().persistent().set(key, value);
    extend_persistent_ttl(env, key);
}

fn delegation_total(records: &Vec<DelegationRecord>) -> Result<i128, Error> {
    records.iter().try_fold(0i128, |total, record| {
        total
            .checked_add(record.amount)
            .ok_or(Error::ArithmeticOverflow)
    })
}

fn proportion(env: &Env, amount: i128, weight: i128, total: i128) -> i128 {
    I256::from_i128(env, amount)
        .mul(&I256::from_i128(env, weight))
        .div(&I256::from_i128(env, total))
        .to_i128()
        .unwrap()
}

fn registered_owner(env: &Env, agent: &Symbol) -> Option<Address> {
    let registry: Address = env.storage().instance().get(&DataKey::Registry)?;
    env.invoke_contract(
        &registry,
        &Symbol::new(env, "get_agent_owner"),
        (agent.clone(),).into_val(env),
    )
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

    /// Configure the authoritative agent registry.
    pub fn set_registry(env: Env, registry: Address) {
        load_admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Registry, &registry);
        extend_instance_ttl(&env);
    }

    /// Associate a wallet with an agent it owns in the registry.
    pub fn bind_agent(env: Env, owner: Address, agent_id: Symbol) -> Result<(), Error> {
        owner.require_auth();
        if registered_owner(&env, &agent_id) != Some(owner.clone()) {
            return Err(Error::UnknownDelegatee);
        }
        save(&env, &DataKey::RegisteredAgent(owner), &agent_id);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Move tokens into the wallet's own, delegatable stake balance.
    pub fn fund_stake(env: Env, owner: Address, amount: i128) -> Result<(), Error> {
        owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidDelegation);
        }
        let balance = own_stake(&env, &owner)
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        let asset = token::Client::new(&env, &load_token(&env));
        asset.transfer(&owner, &env.current_contract_address(), &amount);
        save(&env, &DataKey::OwnStake(owner), &balance);
        extend_instance_ttl(&env);
        Ok(())
    }

    pub fn delegate_stake(
        env: Env,
        delegator: Address,
        delegatee: Address,
        amount: i128,
    ) -> Result<(), Error> {
        delegator.require_auth();
        if amount <= 0 || delegator == delegatee {
            return Err(Error::InvalidDelegation);
        }
        let binding = DataKey::RegisteredAgent(delegatee.clone());
        let agent: Symbol = env
            .storage()
            .persistent()
            .get(&binding)
            .ok_or(Error::UnknownDelegatee)?;
        if registered_owner(&env, &agent) != Some(delegatee.clone()) {
            return Err(Error::UnknownDelegatee);
        }
        if Self::is_blacklisted(env.clone(), delegatee.clone()) {
            return Err(Error::AgentBlacklisted);
        }
        let mut active = delegations(&env, &delegatee);
        let unbonding = pending(&env, &delegatee);
        let balance = own_stake(&env, &delegator);
        if balance < amount {
            return Err(Error::StakeNotFound);
        }
        let existing = active
            .iter()
            .position(|record| record.delegator == delegator);
        if let Some(index) = existing {
            let mut record = active.get(index as u32).unwrap();
            record.amount = record
                .amount
                .checked_add(amount)
                .ok_or(Error::ArithmeticOverflow)?;
            active.set(index as u32, record);
        } else {
            // Pending positions retain their slot until claimed so they remain slashable
            // within the same bounded budget as active positions.
            let pending_only = unbonding
                .iter()
                .filter(|position| {
                    position.delegator != delegatee
                        && !active
                            .iter()
                            .any(|record| record.delegator == position.delegator)
                })
                .count() as u32;
            let already_pending = unbonding
                .iter()
                .any(|position| position.delegator == delegator);
            if active.len() + pending_only >= MAX_DELEGATORS && !already_pending {
                return Err(Error::DelegatorLimitReached);
            }
            active.push_back(DelegationRecord {
                delegator: delegator.clone(),
                amount,
                delegated_at: env.ledger().timestamp(),
            });
        }
        save(
            &env,
            &DataKey::OwnStake(delegator.clone()),
            &(balance - amount),
        );
        save(&env, &DataKey::Delegations(delegatee.clone()), &active);
        extend_persistent_ttl(&env, &binding);
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("delegated")),
            StakeDelegated {
                delegator,
                delegatee,
                amount,
            },
        );
        Ok(())
    }

    /// Begin unbonding. Passing the caller as both addresses unbonds own stake.
    pub fn undelegate_stake(
        env: Env,
        delegator: Address,
        delegatee: Address,
        amount: i128,
    ) -> Result<(), Error> {
        delegator.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidDelegation);
        }
        let mut unbonding = pending(&env, &delegatee);
        if unbonding
            .iter()
            .any(|position| position.delegator == delegator)
        {
            return Err(Error::PendingUndelegationExists);
        }
        if delegator == delegatee {
            let balance = own_stake(&env, &delegator);
            if balance < amount {
                return Err(Error::StakeNotFound);
            }
            save(
                &env,
                &DataKey::OwnStake(delegator.clone()),
                &(balance - amount),
            );
        } else {
            let mut active = delegations(&env, &delegatee);
            let index = active
                .iter()
                .position(|record| record.delegator == delegator)
                .ok_or(Error::StakeNotFound)? as u32;
            let mut record = active.get(index).unwrap();
            if amount > record.amount {
                return Err(Error::StakeNotFound);
            }
            record.amount -= amount;
            if record.amount == 0 {
                active.remove(index);
            } else {
                active.set(index, record);
            }
            save(&env, &DataKey::Delegations(delegatee.clone()), &active);
        }
        let claimable_at = env.ledger().timestamp() + DELEGATION_UNBONDING_SECS;
        unbonding.push_back(PendingUndelegation {
            delegator: delegator.clone(),
            amount,
            claimable_at,
        });
        save(
            &env,
            &DataKey::PendingUndelegations(delegatee.clone()),
            &unbonding,
        );
        extend_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("unbonding")),
            UndelegationInitiated {
                delegator,
                delegatee,
                amount,
                claimable_at,
            },
        );
        Ok(())
    }

    pub fn claim_undelegated(
        env: Env,
        delegator: Address,
        delegatee: Address,
    ) -> Result<i128, Error> {
        delegator.require_auth();
        let mut unbonding = pending(&env, &delegatee);
        let index = unbonding
            .iter()
            .position(|position| position.delegator == delegator)
            .ok_or(Error::UnbondingNotFound)? as u32;
        let position = unbonding.get(index).unwrap();
        if env.ledger().timestamp() < position.claimable_at {
            return Err(Error::UnbondingPeriodActive);
        }
        unbonding.remove(index);
        save(
            &env,
            &DataKey::PendingUndelegations(delegatee.clone()),
            &unbonding,
        );
        if delegator == delegatee {
            if position.amount > 0 {
                token::Client::new(&env, &load_token(&env)).transfer(
                    &env.current_contract_address(),
                    &delegator,
                    &position.amount,
                );
            }
        } else {
            let balance = own_stake(&env, &delegator)
                .checked_add(position.amount)
                .ok_or(Error::ArithmeticOverflow)?;
            save(&env, &DataKey::OwnStake(delegator), &balance);
        }
        extend_instance_ttl(&env);
        Ok(position.amount)
    }

    pub fn get_delegations(env: Env, delegatee: Address) -> Vec<DelegationRecord> {
        delegations(&env, &delegatee)
    }

    pub fn get_effective_stake(env: Env, agent: Address) -> Result<i128, Error> {
        own_stake(&env, &agent)
            .checked_add(delegation_total(&delegations(&env, &agent))?)
            .ok_or(Error::ArithmeticOverflow)
    }

    /// Distribute a payer-funded reward based on active stake at execution.
    pub fn distribute_rewards(
        env: Env,
        payer: Address,
        agent: Address,
        amount: i128,
    ) -> Result<(), Error> {
        payer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidDelegation);
        }
        let active = delegations(&env, &agent);
        let delegated = delegation_total(&active)?;
        let total = own_stake(&env, &agent)
            .checked_add(delegated)
            .ok_or(Error::ArithmeticOverflow)?;
        if total == 0 {
            return Err(Error::StakeNotFound);
        }
        let asset = token::Client::new(&env, &load_token(&env));
        let mut reward_left = amount;
        // Cumulative rounding gives the entire delegated share to delegators.
        let mut weight = 0;
        let mut paid = 0;
        for record in active {
            weight += record.amount;
            let cumulative = proportion(&env, amount, weight, total);
            let reward = cumulative - paid;
            if reward > 0 && payer != record.delegator {
                asset.transfer(&payer, &record.delegator, &reward);
            }
            reward_left -= reward;
            paid = cumulative;
        }
        if reward_left > 0 && payer != agent {
            asset.transfer(&payer, &agent, &reward_left);
        }
        extend_instance_ttl(&env);
        Ok(())
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

        let ledger_seq = env.ledger().sequence() as u64;
        let record = StakeRecord {
            agent_id: agent_id.clone(),
            capability: capability.clone(),
            amount_stroops,
            staked_at: ledger_seq,
            unbonding_since: None,
        };

        let key = DataKey::StakeRecord(agent_id.clone(), capability.clone());
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

        let unbonding_key = DataKey::UnbondingRecord(agent_id.clone(), capability.clone());
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

        let amount_stroops: i128 = if let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, StakeRecord>(&stake_key)
        {
            env.storage().persistent().remove(&stake_key);
            record.amount_stroops
        } else if let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, UnbondingRecord>(&unbonding_key)
        {
            env.storage().persistent().remove(&unbonding_key);
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
    /// Applies the slash proportionally to the address-keyed capability
    /// bond and the agent's token-backed own, delegated, and unbonding stake.
    /// The slash is capped at the total at risk, and the treasury receives
    /// the exact deducted amount. Exhausting active stake blacklists the
    /// agent for 30 ledger-days.
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
    /// - Panics when the agent has no slashable stake.
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

        let addr_key = DataKey::AddressStakeRecord(agent_id.clone(), capability.clone());
        let legacy: Option<AddressStakeRecord> = env.storage().persistent().get(&addr_key);
        let own = own_stake(&env, &agent_id);
        let active = delegations(&env, &agent_id);
        let mut unbonding = pending(&env, &agent_id);
        let legacy_amount = legacy.as_ref().map_or(0, |record| record.amount_stroops);
        let active_total = own + legacy_amount + delegation_total(&active).unwrap();
        let unbonding_total: i128 = unbonding.iter().map(|position| position.amount).sum();
        let total = active_total + unbonding_total;
        if total == 0 {
            panic!("stake not found");
        }
        let actual_slash = slash_amount.min(total);
        // Apply the same rate to every component. Cumulative rounding charges
        // exactly the requested number of stroops across all positions.
        let mut weight = 0;
        let mut deducted = 0;
        let mut deduction = |amount| {
            weight += amount;
            let cumulative = proportion(&env, actual_slash, weight, total);
            let result = cumulative - deducted;
            deducted = cumulative;
            result
        };
        let mut remaining = 0;
        if let Some(mut record) = legacy {
            record.amount_stroops -= deduction(record.amount_stroops);
            remaining += record.amount_stroops;
            if record.amount_stroops == 0 {
                env.storage().persistent().remove(&addr_key);
            } else {
                save(&env, &addr_key, &record);
            }
        }
        let own_remaining = own - deduction(own);
        remaining += own_remaining;
        if own > 0 {
            save(&env, &DataKey::OwnStake(agent_id.clone()), &own_remaining);
        }
        let mut remaining_delegations = Vec::new(&env);
        for mut record in active.iter() {
            record.amount -= deduction(record.amount);
            remaining += record.amount;
            if record.amount > 0 {
                remaining_delegations.push_back(record);
            }
        }
        if !active.is_empty() {
            save(
                &env,
                &DataKey::Delegations(agent_id.clone()),
                &remaining_delegations,
            );
        }
        for index in 0..unbonding.len() {
            let mut position = unbonding.get(index).unwrap();
            position.amount -= deduction(position.amount);
            unbonding.set(index, position);
        }
        if !unbonding.is_empty() {
            save(
                &env,
                &DataKey::PendingUndelegations(agent_id.clone()),
                &unbonding,
            );
        }

        if active_total > 0 && remaining == 0 {
            let blacklist_expires = current_ledger + BLACKLIST_PERIOD_LEDGERS;
            save(
                &env,
                &DataKey::Blacklist(agent_id.clone()),
                &blacklist_expires,
            );
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

        // Retain the dispute-resolution ABI. The dispute tracks the reason.
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

        let own = env
            .storage()
            .persistent()
            .get::<_, StakeRecord>(&DataKey::StakeRecord(agent_id.clone(), capability))
            .map(|record| record.amount_stroops);
        if let Some(owner) = registered_owner(&env, &agent_id) {
            if Self::is_blacklisted(env.clone(), owner.clone()) {
                return false;
            }
            let binding = DataKey::RegisteredAgent(owner.clone());
            let bound_agent: Option<Symbol> = env.storage().persistent().get(&binding);
            let delegated_and_own = if bound_agent == Some(agent_id) {
                extend_persistent_ttl(&env, &binding);
                Self::get_effective_stake(env, owner).unwrap()
            } else {
                0
            };
            return (own.is_some() || delegated_and_own > 0)
                && own.unwrap_or(0).saturating_add(delegated_and_own) >= min_stake;
        }
        own.is_some_and(|amount| amount >= min_stake)
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
