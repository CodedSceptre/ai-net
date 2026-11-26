#![no_std]

//! # PaymentEscrow Contract
//!
//! Manages on-chain escrow for agent task payments.
//!
//! ## Lifecycle
//!
//! 1. **`lock_funds`** — The submitter (coordinator) locks a payment amount for
//!    a specific (task_id, node_id) pair. Funds are held in escrow and marked
//!    `Locked`.
//! 2. **`release_funds`** — The coordinator releases funds to the agent after
//!    successful completion. Only the coordinator may call this.
//! 3. **`refund_funds`** — The coordinator returns the full locked amount to the
//!    original submitter (e.g. on failure or dispute).
//!
//! ## Timeout
//!
//! Escrow entries carry an expiry timestamp (ledger timestamp + 7 days). After
//! expiry anyone may call `refund_funds` and the submitter is refunded
//! automatically — the coordinator auth check is bypassed for expired escrows.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/// 7 days in seconds (used for escrow timeout).
pub const ESCROW_TIMEOUT_SECS: u64 = 7 * 24 * 60 * 60;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKey {
    /// Per-(task_id, node_id) escrow record.
    Escrow(Symbol, Symbol),
    /// Singleton coordinator address (authorized to release/refund).
    Coordinator,
    /// Protocol treasury address receiving platform fees.
    Treasury,
    /// Platform config contract address (optional).
    PlatformConfig,
    /// Platform fee in basis points (1 bps = 0.01 %).
    PlatformFeeBps,
    /// Cumulative platform fees collected in stroops.
    TotalFeesCollected,
    SlaCaller,
    CustodyToken,
    FundedEscrow(Symbol, Symbol),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Escrow entry not found.
    NotFound = 1,
    /// An escrow for this (task_id, node_id) already exists.
    AlreadyLocked = 2,
    /// Caller is not the authorized coordinator.
    Unauthorized = 3,
    /// Lock amount must be greater than zero.
    InvalidAmount = 4,
    /// Attempted to release funds after the escrow timeout has passed.
    EscrowExpired = 5,
    /// Contract has not been initialized yet.
    NotInitialized = 6,
    /// Treasury address has not been set.
    TreasuryNotConfigured = 7,
    /// Invalid fee basis points (must be <= 10_000).
    InvalidFeeBps = 8,
    EscrowAlreadyResolved = 9,
    EscrowMismatch = 10,
    EscrowNotFunded = 11,
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Locked,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    /// Amount locked (in stroops).
    pub amount: i128,
    /// Address of the submitter (will receive refund if applicable).
    pub submitter: Address,
    /// Address of the agent (will receive release payment).
    pub agent: Address,
    /// Ledger timestamp at which this escrow was locked.
    pub locked_at: u64,
    /// Ledger timestamp after which this escrow auto-refunds.
    pub expires_at: u64,
    /// Current lifecycle status.
    pub status: EscrowStatus,
}

// ── Events ────────────────────────────────────────────────────────────────────

fn emit_locked(env: &Env, task_id: &Symbol, node_id: &Symbol, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("locked")),
        (task_id.clone(), node_id.clone(), amount),
    );
}

fn emit_released(env: &Env, task_id: &Symbol, node_id: &Symbol, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("released")),
        (task_id.clone(), node_id.clone(), amount),
    );
}

fn emit_refunded(env: &Env, task_id: &Symbol, node_id: &Symbol, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("refunded")),
        (task_id.clone(), node_id.clone(), amount),
    );
}

/// Event emitted when platform fee is collected on task payment release.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformFeeCollectedEvent {
    pub task_id: Symbol,
    pub agent_id: Address,
    pub fee_amount: i128,
    pub treasury_address: Address,
    pub ledger: u32,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentEscrowContract;

#[contractimpl]
impl PaymentEscrowContract {
    /// Initialize the contract with a coordinator address.
    /// Must be called exactly once before any other function.
    pub fn initialize(env: Env, coordinator: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Coordinator) {
            return Err(Error::AlreadyLocked); // reuse AlreadyLocked as "already initialized"
        }
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Coordinator, &coordinator);
        Ok(())
    }

    /// Set the treasury address that receives platform fees (coordinator only).
    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), Error> {
        let coordinator = Self::read_coordinator(&env)?;
        coordinator.require_auth();
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        Ok(())
    }

    /// Get configured treasury address.
    pub fn get_treasury(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Treasury)
    }

    /// Set platform fee in basis points (1 bps = 0.01 %, e.g. 100 = 1%) (coordinator only).
    pub fn set_platform_fee_bps(env: Env, fee_bps: u32) -> Result<(), Error> {
        let coordinator = Self::read_coordinator(&env)?;
        coordinator.require_auth();
        if fee_bps > 10_000 {
            return Err(Error::InvalidFeeBps);
        }
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &fee_bps);
        Ok(())
    }

    /// Get configured platform fee in basis points.
    pub fn get_platform_fee_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(0)
    }

    /// Get total platform fees collected in stroops.
    pub fn get_total_fees_collected(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalFeesCollected)
            .unwrap_or(0)
    }

    /// Set platform config contract address (coordinator only).
    pub fn set_platform_config(env: Env, platform_config: Address) -> Result<(), Error> {
        let coordinator = Self::read_coordinator(&env)?;
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PlatformConfig, &platform_config);
        Ok(())
    }

    /// Enable token custody for new escrows and authorize the task store.
    pub fn configure_sla_refunds(
        env: Env,
        task_store: Address,
        token_contract: Address,
    ) -> Result<(), Error> {
        Self::read_coordinator(&env)?.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::SlaCaller, &task_store);
        env.storage()
            .instance()
            .set(&DataKey::CustodyToken, &token_contract);
        Ok(())
    }

    /// Lock `amount` stroops for a given (task_id, node_id) pair.
    ///
    /// Only the coordinator may call this. The escrow is valid for
    /// `ESCROW_TIMEOUT_SECS` from the time of locking.
    pub fn lock_funds(
        env: Env,
        task_id: Symbol,
        node_id: Symbol,
        submitter: Address,
        agent: Address,
        amount: i128,
    ) -> Result<(), Error> {
        let coordinator = Self::read_coordinator(&env)?;
        coordinator.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let key = DataKey::Escrow(task_id.clone(), node_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyLocked);
        }

        let now = env.ledger().timestamp();
        let record = EscrowRecord {
            amount,
            submitter,
            agent,
            locked_at: now,
            expires_at: now + ESCROW_TIMEOUT_SECS,
            status: EscrowStatus::Locked,
        };

        if let Some(asset) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::CustodyToken)
        {
            record.submitter.require_auth();
            token::Client::new(&env, &asset).transfer(
                &record.submitter,
                &env.current_contract_address(),
                &amount,
            );
            env.storage().persistent().set(
                &DataKey::FundedEscrow(task_id.clone(), node_id.clone()),
                &asset,
            );
        }
        env.storage().persistent().set(&key, &record);
        emit_locked(&env, &task_id, &node_id, amount);
        Ok(())
    }

    /// Release the locked funds to the agent.
    ///
    /// Only the coordinator may call this. Fails if the escrow has expired.
    pub fn release_funds(
        env: Env,
        task_id: Symbol,
        node_id: Symbol,
    ) -> Result<EscrowRecord, Error> {
        let coordinator = Self::read_coordinator(&env)?;
        coordinator.require_auth();

        let key = DataKey::Escrow(task_id.clone(), node_id.clone());
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;

        if record.status != EscrowStatus::Locked {
            return Err(Error::EscrowAlreadyResolved);
        }
        let asset: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::FundedEscrow(task_id.clone(), node_id.clone()));

        // Releasing after timeout is not allowed — caller should call
        // refund_funds instead once the escrow has expired.
        let now = env.ledger().timestamp();
        if now >= record.expires_at {
            return Err(Error::EscrowExpired);
        }

        let fee_bps = Self::get_platform_fee_bps(env.clone());
        let fee_amount = if fee_bps > 0 {
            record.amount / 10_000 * fee_bps as i128
                + record.amount % 10_000 * fee_bps as i128 / 10_000
        } else {
            0
        };

        if fee_amount > 0 {
            let treasury = env
                .storage()
                .instance()
                .get::<_, Address>(&DataKey::Treasury)
                .ok_or(Error::TreasuryNotConfigured)?;

            if let Some(asset) = &asset {
                token::Client::new(&env, asset).transfer(
                    &env.current_contract_address(),
                    &treasury,
                    &fee_amount,
                );
            }

            let total_fees: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TotalFeesCollected)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::TotalFeesCollected, &(total_fees + fee_amount));

            env.events().publish(
                (Symbol::new(&env, "platform_fee_collected"),),
                PlatformFeeCollectedEvent {
                    task_id: task_id.clone(),
                    agent_id: record.agent.clone(),
                    fee_amount,
                    treasury_address: treasury,
                    ledger: env.ledger().sequence(),
                },
            );
        }

        if let Some(asset) = &asset {
            token::Client::new(&env, asset).transfer(
                &env.current_contract_address(),
                &record.agent,
                &(record.amount - fee_amount),
            );
        }
        record.status = EscrowStatus::Released;
        emit_released(&env, &task_id, &node_id, record.amount - fee_amount);
        env.storage().persistent().set(&key, &record);
        Ok(record)
    }

    /// Refund the locked funds back to the submitter.
    ///
    /// The coordinator may call this at any time. After the timeout,
    /// *anyone* may call this (auto-refund path).
    pub fn refund_funds(env: Env, task_id: Symbol, node_id: Symbol) -> Result<EscrowRecord, Error> {
        let record = Self::get_escrow(env.clone(), task_id.clone(), node_id.clone())?;
        if env.ledger().timestamp() < record.expires_at {
            Self::read_coordinator(&env)?.require_auth();
        }
        Self::settle_refund(&env, task_id, node_id, record)
    }

    /// Refund a funded escrow when the authorized task store enforces an SLA.
    pub fn refund(
        env: Env,
        task_id: Symbol,
        node_id: Symbol,
        submitter: Address,
        agent: Address,
    ) -> Result<(), Error> {
        let task_store: Address = env
            .storage()
            .instance()
            .get(&DataKey::SlaCaller)
            .ok_or(Error::Unauthorized)?;
        task_store.require_auth();
        let record = Self::get_escrow(env.clone(), task_id.clone(), node_id.clone())?;
        if record.submitter != submitter || record.agent != agent {
            return Err(Error::EscrowMismatch);
        }
        if !env
            .storage()
            .persistent()
            .has(&DataKey::FundedEscrow(task_id.clone(), node_id.clone()))
        {
            return Err(Error::EscrowNotFunded);
        }
        Self::settle_refund(&env, task_id, node_id, record)?;
        Ok(())
    }

    fn settle_refund(
        env: &Env,
        task_id: Symbol,
        node_id: Symbol,
        mut record: EscrowRecord,
    ) -> Result<EscrowRecord, Error> {
        match record.status {
            EscrowStatus::Released => return Err(Error::EscrowAlreadyResolved),
            EscrowStatus::Refunded => return Ok(record),
            EscrowStatus::Locked => {}
        }
        record.status = EscrowStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(task_id.clone(), node_id.clone()), &record);
        if let Some(asset) = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::FundedEscrow(task_id.clone(), node_id.clone()))
        {
            token::Client::new(env, &asset).transfer(
                &env.current_contract_address(),
                &record.submitter,
                &record.amount,
            );
        }
        emit_refunded(env, &task_id, &node_id, record.amount);
        Ok(record)
    }

    /// Read the current escrow record without mutating it.
    pub fn get_escrow(env: Env, task_id: Symbol, node_id: Symbol) -> Result<EscrowRecord, Error> {
        let key = DataKey::Escrow(task_id, node_id);
        env.storage().persistent().get(&key).ok_or(Error::NotFound)
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn read_coordinator(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Coordinator)
            .ok_or(Error::NotInitialized)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test;
