//! # Vesting Module
//!
//! Implements time-locked linear vesting for platform token rewards. Agents
//! earn rewards upfront but can only access them progressively over a vesting
//! period (default 6 months), preventing pump-and-dump dynamics.
//!
//! ## Vesting Formula
//!
//! ```text
//! elapsed   = min(current_timestamp - start_timestamp, duration_seconds)
//! vested    = total_amount * elapsed / duration_seconds
//! claimable = vested - claimed_amount
//! ```
//!
//! ## Storage
//!
//! Schedules are stored in `Persistent` storage keyed by `DataKey::Vesting(agent_id)`.
//!
//! ## Events
//!
//! | Function                   | topics                        | Data                   |
//! |---------------------------|-------------------------------|------------------------|
//! | `create_vesting_schedule` | `["vesting", "created"]`      | `VestingCreatedEvent`  |
//! | `claim_vested`            | `["vesting", "claimed"]`      | `VestingClaimedEvent`  |

use soroban_sdk::{contracttype, symbol_short, Address, Env};

use crate::errors::Error;

// ─── TTL constants ────────────────────────────────────────────────────────────

/// Threshold (ledgers) below which TTL is extended (~100 k ≈ ~6 days at 5 s/ledger).
const TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (~535 k ≈ ~31 days at 5 s/ledger).
const TTL_EXTEND_TO: u32 = 535_680;

// ─── Storage key ─────────────────────────────────────────────────────────────

/// Top-level storage discriminant for the reputation contract.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Singleton admin address stored in Instance storage.
    Admin,
    /// Per-agent vesting schedule stored in Persistent storage.
    Vesting(Address),
}

// ─── Core data structures ─────────────────────────────────────────────────────

/// A linear vesting schedule for a single agent.
///
/// All token amounts are expressed as `i128` (the canonical Soroban token unit).
/// Timestamps are UNIX seconds as returned by `env.ledger().timestamp()`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    /// Total tokens that will vest over the full duration.
    pub total_amount: i128,
    /// UNIX timestamp (seconds) at which vesting begins.
    pub start_timestamp: u64,
    /// Length of the vesting period in seconds (e.g. 15_552_000 ≈ 6 months).
    pub duration_seconds: u64,
    /// Tokens already claimed by the agent.
    pub claimed_amount: i128,
}

/// Return value of `get_vesting_state`: the schedule plus currently claimable
/// amount computed at query time.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingState {
    pub schedule: VestingSchedule,
    /// How many tokens can be claimed right now (`vested - claimed`).
    pub claimable: i128,
}

// ─── Events ───────────────────────────────────────────────────────────────────

/// Emitted when a new vesting schedule is created.
#[contracttype]
pub struct VestingCreatedEvent {
    pub agent_id: Address,
    pub total_amount: i128,
    pub start_timestamp: u64,
    pub duration_seconds: u64,
}

/// Emitted when an agent successfully claims vested tokens.
#[contracttype]
pub struct VestingClaimedEvent {
    /// The agent whose vested tokens were claimed.
    pub agent_id: Address,
    /// Tokens transferred in this specific claim.
    pub amount_claimed: i128,
    /// Cumulative tokens claimed to date (including this claim).
    pub total_claimed: i128,
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Compute the number of tokens currently vested (not necessarily claimable)
/// given the schedule and the current ledger timestamp.
///
/// Returns `Err(Error::VestingNotStarted)` if `now < start_timestamp`.
fn compute_vested(schedule: &VestingSchedule, now: u64) -> Result<i128, Error> {
    if now < schedule.start_timestamp {
        return Err(Error::VestingNotStarted);
    }

    let elapsed = now.saturating_sub(schedule.start_timestamp);
    // Cap elapsed at duration so we never exceed total_amount.
    let capped_elapsed = elapsed.min(schedule.duration_seconds);

    // vested = total_amount * capped_elapsed / duration_seconds
    // Use i128 arithmetic; both operands fit because capped_elapsed ≤ duration_seconds.
    let vested = schedule
        .total_amount
        .saturating_mul(capped_elapsed as i128)
        / (schedule.duration_seconds as i128);

    Ok(vested)
}

fn extend_vesting_ttl(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

// ─── Public functions ─────────────────────────────────────────────────────────

/// **Admin-only.** Create a new linear vesting schedule for `agent_id`.
///
/// # Errors
///
/// * [`Error::Unauthorized`]        — caller is not the contract admin.
/// * [`Error::InvalidAmount`]       — `amount` is zero or negative.
/// * [`Error::InvalidDuration`]     — `duration` is zero.
/// * [`Error::VestingAlreadyExists`] — the agent already has an active schedule
///   (i.e. one where `claimed_amount < total_amount`).
pub fn create_vesting_schedule(
    env: &Env,
    caller: &Address,
    admin: &Address,
    agent_id: Address,
    amount: i128,
    start: u64,
    duration: u64,
) -> Result<(), Error> {
    // Authorization: only the admin may create schedules.
    caller.require_auth();
    if caller != admin {
        return Err(Error::Unauthorized);
    }

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if duration == 0 {
        return Err(Error::InvalidDuration);
    }

    let key = DataKey::Vesting(agent_id.clone());

    // Prevent overwriting an existing active schedule.
    if let Some(existing) = env
        .storage()
        .persistent()
        .get::<DataKey, VestingSchedule>(&key)
    {
        if existing.claimed_amount < existing.total_amount {
            return Err(Error::VestingAlreadyExists);
        }
    }

    let schedule = VestingSchedule {
        total_amount: amount,
        start_timestamp: start,
        duration_seconds: duration,
        claimed_amount: 0,
    };

    env.storage().persistent().set(&key, &schedule);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

    env.events().publish(
        (symbol_short!("vesting"), symbol_short!("created")),
        VestingCreatedEvent {
            agent_id,
            total_amount: amount,
            start_timestamp: start,
            duration_seconds: duration,
        },
    );

    Ok(())
}

/// Compute and transfer the currently claimable vested tokens to `agent_id`.
///
/// If nothing has vested yet beyond what has already been claimed, returns `Ok(0)`
/// without emitting an event (no double-claim, no-op on duplicate calls in the
/// same ledger).
///
/// # Errors
///
/// * [`Error::VestingNotFound`]  — no schedule exists for this agent.
/// * [`Error::VestingNotStarted`] — `ledger().timestamp() < start_timestamp`.
pub fn claim_vested(env: &Env, agent_id: Address) -> Result<i128, Error> {
    agent_id.require_auth();

    let key = DataKey::Vesting(agent_id.clone());

    let mut schedule: VestingSchedule = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::VestingNotFound)?;

    let now = env.ledger().timestamp();
    let vested = compute_vested(&schedule, now)?;

    let claimable = vested.saturating_sub(schedule.claimed_amount);

    if claimable <= 0 {
        // Nothing new to claim — return 0 without updating storage or emitting.
        extend_vesting_ttl(env, &key);
        return Ok(0);
    }

    schedule.claimed_amount = schedule.claimed_amount.saturating_add(claimable);
    env.storage().persistent().set(&key, &schedule);
    extend_vesting_ttl(env, &key);

    env.events().publish(
        (symbol_short!("vesting"), symbol_short!("claimed")),
        VestingClaimedEvent {
            agent_id,
            amount_claimed: claimable,
            total_claimed: schedule.claimed_amount,
        },
    );

    Ok(claimable)
}

/// Return the full vesting schedule for `agent_id` together with the amount
/// claimable at the current ledger timestamp.
///
/// Returns `Ok(VestingState { claimable: 0 })` when vesting has not yet started
/// (instead of an error) so callers can inspect the schedule freely.
///
/// # Errors
///
/// * [`Error::VestingNotFound`] — no schedule exists for this agent.
pub fn get_vesting_state(env: &Env, agent_id: Address) -> Result<VestingState, Error> {
    let key = DataKey::Vesting(agent_id);
    let schedule: VestingSchedule = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::VestingNotFound)?;

    let now = env.ledger().timestamp();
    let claimable = match compute_vested(&schedule, now) {
        Ok(vested) => vested.saturating_sub(schedule.claimed_amount).max(0),
        // If vesting hasn't started yet, claimable is 0 — not an error for a
        // read-only query.
        Err(Error::VestingNotStarted) => 0,
        Err(e) => return Err(e),
    };

    Ok(VestingState { schedule, claimable })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Env,
    };

    /// Six months in seconds (approx).
    const SIX_MONTHS: u64 = 15_552_000;

    fn setup_env() -> Env {
        Env::default()
    }

    fn make_addresses(env: &Env) -> (Address, Address) {
        (Address::generate(env), Address::generate(env))
    }

    /// Set the mock ledger timestamp.
    fn set_time(env: &Env, ts: u64) {
        env.ledger().set(LedgerInfo {
            timestamp: ts,
            protocol_version: 22,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 6_312_000,
        });
    }

    // Helper: create a schedule via the internal function, bypassing auth
    // by using `env.mock_all_auths()`.
    fn create_schedule(
        env: &Env,
        admin: &Address,
        agent: Address,
        amount: i128,
        start: u64,
        duration: u64,
    ) {
        env.mock_all_auths();
        create_vesting_schedule(env, admin, admin, agent, amount, start, duration)
            .expect("create_vesting_schedule failed");
    }

    // ── 0% elapsed ────────────────────────────────────────────────────────────

    #[test]
    fn test_nothing_claimable_at_start() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;
        set_time(&env, start); // exactly at start

        create_schedule(&env, &admin, agent.clone(), 1_000_000, start, SIX_MONTHS);

        env.mock_all_auths();
        let claimed = claim_vested(&env, agent.clone()).expect("claim failed");
        // elapsed = 0 → vested = 0 → claimable = 0
        assert_eq!(claimed, 0);
    }

    // ── 50% elapsed ───────────────────────────────────────────────────────────

    #[test]
    fn test_exactly_half_duration_claimable() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;
        let total = 1_000_000i128;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), total, start, SIX_MONTHS);

        // Advance to exactly 50% of the duration.
        set_time(&env, start + SIX_MONTHS / 2);
        env.mock_all_auths();
        let claimed = claim_vested(&env, agent.clone()).expect("claim at 50% failed");

        assert_eq!(claimed, total / 2, "at 50% duration exactly 50% should vest");
    }

    // ── 100% elapsed ──────────────────────────────────────────────────────────

    #[test]
    fn test_full_duration_all_claimable() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;
        let total = 2_000_000i128;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), total, start, SIX_MONTHS);

        set_time(&env, start + SIX_MONTHS);
        env.mock_all_auths();
        let claimed = claim_vested(&env, agent.clone()).expect("claim at 100% failed");

        assert_eq!(claimed, total, "at 100% duration all tokens should vest");
    }

    // ── 110% elapsed — cap at total ───────────────────────────────────────────

    #[test]
    fn test_beyond_full_duration_caps_at_total() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;
        let total = 500_000i128;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), total, start, SIX_MONTHS);

        // 110% of duration
        set_time(&env, start + SIX_MONTHS + SIX_MONTHS / 10);
        env.mock_all_auths();
        let claimed = claim_vested(&env, agent.clone()).expect("claim at 110% failed");

        assert_eq!(claimed, total, "beyond full duration should still yield total_amount");
    }

    // ── Before start → VestingNotStarted ─────────────────────────────────────

    #[test]
    fn test_claim_before_start_returns_error() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 2_000_000u64;

        // Current time is before start.
        set_time(&env, start - 1);
        create_schedule(&env, &admin, agent.clone(), 1_000_000, start, SIX_MONTHS);

        env.mock_all_auths();
        let result = claim_vested(&env, agent.clone());

        assert_eq!(result, Err(Error::VestingNotStarted));
    }

    // ── No double-claim in same ledger ────────────────────────────────────────

    #[test]
    fn test_no_double_claim_same_ledger() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), 1_000_000, start, SIX_MONTHS);

        set_time(&env, start + SIX_MONTHS / 2);

        env.mock_all_auths();
        let first = claim_vested(&env, agent.clone()).expect("first claim failed");
        assert_eq!(first, 500_000);

        env.mock_all_auths();
        let second = claim_vested(&env, agent.clone()).expect("second claim failed");
        assert_eq!(second, 0, "second claim in same ledger should return 0");
    }

    // ── Partial claims ────────────────────────────────────────────────────────

    #[test]
    fn test_partial_claims_incremental() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;
        let total = 1_200_000i128;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), total, start, SIX_MONTHS);

        // Claim at 3 months (50%).
        set_time(&env, start + SIX_MONTHS / 2);
        env.mock_all_auths();
        let first = claim_vested(&env, agent.clone()).expect("first partial claim");
        assert_eq!(first, 600_000); // 50% of 1_200_000

        // Claim at 5 months (83.33..%).
        // vested_at_5m = 1_200_000 * (5/6) = 1_000_000
        // claimable    = 1_000_000 - 600_000 = 400_000
        let five_months = SIX_MONTHS * 5 / 6;
        set_time(&env, start + five_months);
        env.mock_all_auths();
        let second = claim_vested(&env, agent.clone()).expect("second partial claim");
        // vested = 1_200_000 * five_months / SIX_MONTHS
        let expected_vested = total * (five_months as i128) / (SIX_MONTHS as i128);
        assert_eq!(second, expected_vested - first);
    }

    // ── Prevent duplicate schedule creation ───────────────────────────────────

    #[test]
    fn test_cannot_create_duplicate_active_schedule() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), 1_000_000, start, SIX_MONTHS);

        // Attempt to create another schedule while the first is still active.
        env.mock_all_auths();
        let result =
            create_vesting_schedule(&env, &admin, &admin, agent.clone(), 500_000, start, SIX_MONTHS);

        assert_eq!(result, Err(Error::VestingAlreadyExists));
    }

    // ── get_vesting_state ─────────────────────────────────────────────────────

    #[test]
    fn test_get_vesting_state_before_start() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 5_000_000u64;

        set_time(&env, start - 1000);
        create_schedule(&env, &admin, agent.clone(), 1_000_000, start, SIX_MONTHS);

        let state = get_vesting_state(&env, agent).expect("get_vesting_state failed");
        assert_eq!(state.claimable, 0, "before start claimable should be 0");
    }

    #[test]
    fn test_get_vesting_state_at_half() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let start = 1_000_000u64;

        set_time(&env, start);
        create_schedule(&env, &admin, agent.clone(), 1_000_000, start, SIX_MONTHS);

        set_time(&env, start + SIX_MONTHS / 2);
        let state = get_vesting_state(&env, agent).expect("get_vesting_state failed");
        assert_eq!(state.claimable, 500_000);
        assert_eq!(state.schedule.claimed_amount, 0);
    }

    // ── Unauthorized admin check ───────────────────────────────────────────────

    #[test]
    fn test_non_admin_cannot_create_schedule() {
        let env = setup_env();
        let (admin, agent) = make_addresses(&env);
        let non_admin = Address::generate(&env);
        let start = 1_000_000u64;

        set_time(&env, start);

        env.mock_all_auths();
        let result =
            create_vesting_schedule(&env, &non_admin, &admin, agent, 1_000_000, start, SIX_MONTHS);

        assert_eq!(result, Err(Error::Unauthorized));
    }
}
