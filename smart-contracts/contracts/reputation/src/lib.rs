#![no_std]

//! # On-Chain Reputation Contract
//!
//! Tracks reputation scores for agents based on task outcomes.
//!
//! ## Scoring Rules
//!
//! | Event                    | Score change       |
//! |--------------------------|--------------------|
//! | Successful task          | +10 points         |
//! | Failed task              | -20 points         |
//! | 5-star rating multiplier | × 1.5              |
//! | Time decay (per week)    | -5 % of current    |
//!
//! Scores are stored as fixed-point integers multiplied by 100 to retain two
//! decimal places (e.g., a score of 100.00 is stored as 10_000). The floor
//! is 0 — a score never goes negative.
//!
//! ## Authorization
//!
//! Only addresses registered via `add_authorized_caller` (typically the
//! `task_store` or coordinator contract) may call `record_outcome`.
//! `decay_reputation` is permissionless so it can be called by cron jobs or
//! any operator.
//!
//! ## Events
//!
//! | Event               | Topics                         |
//! |---------------------|--------------------------------|
//! | Outcome recorded    | `(reputation, outcome)`        |
//! | Decay applied       | `(reputation, decayed)`        |

mod errors;

pub use errors::Error;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Symbol, Vec,
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Map, Symbol,
    TryFromVal, Val, Vec,
};

// ─── Scoring constants ────────────────────────────────────────────────────────

/// Points awarded for a successful task (scaled ×100).
pub const SUCCESS_POINTS: i64 = 1_000; // 10.00 points
/// Points deducted for a failed task (scaled ×100).
pub const FAILURE_POINTS: i64 = 2_000; // 20.00 points
/// 5-star rating multiplier numerator (×100 precision: 150 = 1.5×).
pub const FIVE_STAR_MULTIPLIER_BPS: i64 = 150;
/// Weekly decay rate in basis points (5 % = 500 bps out of 10_000).
pub const DECAY_RATE_BPS: i64 = 500;
/// Seconds per week (7 × 86_400).
pub const SECONDS_PER_WEEK: u64 = 604_800;
/// The 1.00 point decay floor in the stored ×100 representation.
pub const DECAY_FLOOR: i64 = 100;
/// Initial score for a first-time agent (scaled ×100).
pub const INITIAL_SCORE: i64 = 5_000; // 50.00 points

/// TTL threshold / target (ledgers).
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 241_920;

// ─── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PenaltyReason {
    SLABreach,
}

/// Per-agent reputation record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationScore {
    /// The agent's identifier.
    pub agent_id: Symbol,
    /// Current score, scaled ×100 (e.g., 10_000 = 100.00 points).
    pub score: i64,
    /// Number of successful tasks.
    pub successful_tasks: u64,
    /// Number of failed tasks.
    pub failed_tasks: u64,
    /// UNIX timestamp (seconds) of the last outcome recorded.
    pub last_activity: u64,
    /// UNIX timestamp (seconds) of the most recent decay application.
    pub last_decay_at: u64,
    pub last_task_completed_at: u64,
    pub next_decay_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecaySchedule {
    pub next_decay_at: u64,
    pub score: i64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecayApplied {
    pub agent_id: Address,
    pub old_score: i64,
    pub new_score: i64,
}

/// Event emitted when an outcome is recorded for an agent.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutcomeRecordedEvent {
    pub agent_id: Symbol,
    pub task_id: Symbol,
    pub success: bool,
    pub rating: u32,
    pub new_score: i64,
}

/// Event emitted when time-decay is applied to an agent's score.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationDecayedEvent {
    pub agent_id: Symbol,
    pub old_score: i64,
    pub new_score: i64,
    pub weeks_elapsed: u64,
}

/// Storage key enumeration.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    AuthRegistry,
    Admin,
    /// Set of authorized caller addresses (e.g. task_store contract).
    AuthorizedCallers,
    /// Reputation record for an agent.
    Reputation(Symbol),
    AgentAddress(Address),
}

// ─── Contract ────────────────────────────────────────────────────────────────
//! # Reputation Contract
//!
//! Manages agent reputation on the Stellar network, including time-locked
//! linear vesting schedules for platform token rewards.
//!
//! ## Vesting Overview
//!
//! To prevent short-term pump-and-dump dynamics, earned rewards are locked in a
//! linear vesting schedule. Agents can claim their proportional share at any
//! point during the vesting window:
//!
//! ```text
//! elapsed   = min(now - start_timestamp, duration_seconds)
//! vested    = total_amount * elapsed / duration_seconds
//! claimable = vested - claimed_amount
//! ```
//!
//! ## Public Functions
//!
//! | Function                   | Description                                        |
//! |----------------------------|----------------------------------------------------|
//! | `initialize`               | One-time admin setup                               |
//! | `create_vesting_schedule`  | Admin: create a vesting schedule for an agent      |
//! | `claim_vested`             | Agent: claim currently vested tokens               |
//! | `get_vesting_state`        | Read-only: schedule + claimable at current time    |

pub mod vesting;
mod errors;

pub use errors::Error;
pub use vesting::{VestingSchedule, VestingState, DataKey};

use soroban_sdk::{contract, contractimpl, Address, Env};

// ─── TTL constants ────────────────────────────────────────────────────────────

const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 535_680;

// ─── Contract ──────────────────────────────────────────────���─────────────────

#[contract]
pub struct ReputationContract;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn require_initialized(env: &Env) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::Admin) {
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

fn registry_allows(env: &Env, registry: &Address, caller: &Address, function: &str) -> bool {
    env.invoke_contract(
        registry,
        &Symbol::new(env, "is_authorized"),
        (
            caller.clone(),
            env.current_contract_address(),
            soroban_sdk::String::from_str(env, function),
        )
            .into_val(env),
    )
}

fn is_authorized_caller(env: &Env, addr: &Address) -> bool {
    let callers: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::AuthorizedCallers)
        .unwrap_or_else(|| Vec::new(env));
    callers.contains(addr)
}

fn read_score(env: &Env, agent_id: &Symbol) -> Option<ReputationScore> {
    let mut fields: Map<Symbol, Val> = env
        .storage()
        .persistent()
        .get(&DataKey::Reputation(agent_id.clone()))?;
    let completed = Symbol::new(env, "last_task_completed_at");
    if !fields.contains_key(completed.clone()) {
        // Legacy records did not distinguish the last success from the last outcome.
        let activity = fields.get(Symbol::new(env, "last_activity"))?;
        let activity = u64::try_from_val(env, &activity).ok()?;
        let last_decay = fields.get(Symbol::new(env, "last_decay_at"))?;
        let last_decay = u64::try_from_val(env, &last_decay).ok()?;
        fields.set(completed, activity.into_val(env));
        fields.set(
            Symbol::new(env, "next_decay_at"),
            activity
                .max(last_decay)
                .saturating_add(SECONDS_PER_WEEK)
                .into_val(env),
        );
    }
    let value: Val = fields.into_val(env);
    ReputationScore::try_from_val(env, &value).ok()
}

fn load_or_create_score(env: &Env, agent_id: &Symbol) -> ReputationScore {
    let now = env.ledger().timestamp();
    read_score(env, agent_id).unwrap_or_else(|| ReputationScore {
        agent_id: agent_id.clone(),
        score: INITIAL_SCORE,
        successful_tasks: 0,
        failed_tasks: 0,
        last_activity: now,
        last_decay_at: now,
        last_task_completed_at: now,
        next_decay_at: now.saturating_add(SECONDS_PER_WEEK),
    })
}

fn save_score(env: &Env, score: &ReputationScore) {
    env.storage()
        .persistent()
        .set(&DataKey::Reputation(score.agent_id.clone()), score);
    env.storage().persistent().extend_ttl(
        &DataKey::Reputation(score.agent_id.clone()),
        TTL_THRESHOLD,
        TTL_EXTEND_TO,
    );
}

/// Apply compound time-decay for `weeks_elapsed` weeks:
///   new_score = old_score × (1 - DECAY_RATE_BPS/10_000)^weeks
/// We iterate to avoid floating point; each iteration multiplies by
/// (10_000 - 500) / 10_000 = 0.95 in fixed-point.
fn apply_decay(score: i64, weeks_elapsed: u64) -> i64 {
    if weeks_elapsed == 0 {
        return score;
    }
    let mut s = score;
    for _ in 0..weeks_elapsed {
        if s <= DECAY_FLOOR {
            break;
        }
        s = (i128::from(s) * i128::from(10_000 - DECAY_RATE_BPS) / 10_000) as i64;
    }
    s.max(DECAY_FLOOR)
}

// ─── Implementation ───────────────────────────────────────────────────────────

#[contractimpl]
impl ReputationContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the contract with an admin address.
#[contractimpl]
impl ReputationContract {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// One-time initialisation: set the contract admin.
    ///
    /// # Errors
    ///
    /// * [`Error::AlreadyInitialized`] — called more than once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        let empty: Vec<Address> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCallers, &empty);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    // ── Authorization management ──────────────────────────────────────────────

    /// Configure the platform authorization registry for privileged calls.
    pub fn set_auth_registry(env: Env, registry: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AuthRegistry, &registry);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Add an address that is allowed to call `record_outcome`.
    ///
    /// Only the admin may add authorized callers.
    pub fn add_authorized_caller(env: Env, caller: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let mut callers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedCallers)
            .unwrap_or_else(|| Vec::new(&env));

        if callers.contains(&caller) {
            return Err(Error::CallerAlreadyRegistered);
        }

        callers.push_back(caller);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCallers, &callers);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        Ok(())
    }

    /// Remove an authorized caller.
    pub fn remove_authorized_caller(env: Env, caller: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        let callers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedCallers)
            .unwrap_or_else(|| Vec::new(&env));

        let mut updated = Vec::new(&env);
        let mut found = false;
        for c in callers.iter() {
            if c == caller {
                found = true;
            } else {
                updated.push_back(c);
            }
        }

        if !found {
            return Err(Error::CallerNotFound);
        }

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCallers, &updated);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        Ok(())
    }

    // ── Core operations ───────────────────────────────────────────────────────

    pub fn apply_penalty(
        env: Env,
        caller: Address,
        agent_id: Symbol,
        reason: PenaltyReason,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        if !is_authorized_caller(&env, &caller) {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        let mut rep = load_or_create_score(&env, &agent_id);
        rep.score = rep.score.saturating_sub(FAILURE_POINTS).max(0);
        rep.failed_tasks = rep.failed_tasks.saturating_add(1);
        rep.last_activity = env.ledger().timestamp();
        save_score(&env, &rep);
        env.events().publish(
            (symbol_short!("reputat"), symbol_short!("penalty")),
            (agent_id, reason, rep.score),
        );
        Ok(())
    }

    /// Record a task outcome for an agent.
    ///
    /// Only addresses registered via `add_authorized_caller` may call this.
    /// The caller must authorise the transaction.
    ///
    /// `rating` must be in the range `[0, 5]`.
    ///
    /// Scoring:
    /// - `success = true`:  +10 points (× 1.5 if rating == 5)
    /// - `success = false`: -20 points
    ///
    /// Emits `(reputation, outcome)`.
    pub fn record_outcome(
        env: Env,
        caller: Address,
        agent_id: Symbol,
        task_id: Symbol,
        success: bool,
        rating: u32,
    ) -> Result<(), Error> {
        require_initialized(&env)?;

        let registry: Option<Address> = env.storage().instance().get(&DataKey::AuthRegistry);
        let allowed = match registry {
            Some(registry) => registry_allows(&env, &registry, &caller, "record_outcome"),
            None => is_authorized_caller(&env, &caller),
        };
        if !allowed {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();

        if rating > 5 {
            return Err(Error::InvalidRating);
        }

        let mut rep = load_or_create_score(&env, &agent_id);
        let old_score = rep.score;

        let delta: i64 = if success {
            let base = SUCCESS_POINTS;
            if rating == 5 {
                base * FIVE_STAR_MULTIPLIER_BPS / 100
            } else {
                base
            }
        } else {
            -FAILURE_POINTS
        };

        rep.score = (old_score + delta).max(0);

        if success {
            rep.successful_tasks += 1;
            rep.last_task_completed_at = env.ledger().timestamp();
            rep.next_decay_at = rep.last_task_completed_at.saturating_add(SECONDS_PER_WEEK);
        } else {
            rep.failed_tasks += 1;
        }
        rep.last_activity = env.ledger().timestamp();

        save_score(&env, &rep);

        env.events().publish(
            (symbol_short!("reputat"), symbol_short!("outcome")),
            OutcomeRecordedEvent {
                agent_id,
                task_id,
                success,
                rating,
                new_score: rep.score,
            },
        );

        Ok(())
    }

    /// Associate the heartbeat system's address with an existing reputation ID.
    pub fn set_agent_address(env: Env, agent: Address, agent_id: Symbol) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let key = DataKey::AgentAddress(agent);
        let storage = env.storage().persistent();
        storage.set(&key, &agent_id);
        storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Apply deterministic inactivity decay for the heartbeat system.
    pub fn apply_decay(env: Env, agent_id: Address) -> Result<(), Error> {
        let key = DataKey::AgentAddress(agent_id.clone());
        let stored_id = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AgentNotFound)?;
        if let Some(event) = Self::decay(&env, stored_id)? {
            env.events().publish(
                (symbol_short!("reputat"), Symbol::new(&env, "decay_applied")),
                DecayApplied {
                    agent_id,
                    old_score: event.old_score,
                    new_score: event.new_score,
                },
            );
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        Ok(())
    }

    pub fn get_decay_schedule(env: Env, agent_id: Address) -> Result<DecaySchedule, Error> {
        let stored_id = env
            .storage()
            .persistent()
            .get(&DataKey::AgentAddress(agent_id))
            .ok_or(Error::AgentNotFound)?;
        let record = Self::get_reputation(env, stored_id)?;
        Ok(DecaySchedule {
            next_decay_at: record.next_decay_at,
            score: record.score,
        })
    }

    /// Apply the same inactivity schedule through the existing Symbol API.
    pub fn decay_reputation(env: Env, agent_id: Symbol) -> Result<(), Error> {
        require_initialized(&env)?;
        if let Some(event) = Self::decay(&env, agent_id)? {
            env.events()
                .publish((symbol_short!("reputat"), symbol_short!("decayed")), event);
        }
        Ok(())
    }

    fn decay(env: &Env, agent_id: Symbol) -> Result<Option<ReputationDecayedEvent>, Error> {
        let mut rep = read_score(env, &agent_id).ok_or(Error::AgentNotFound)?;
        let now = env.ledger().timestamp();
        if now < rep.next_decay_at {
            return Ok(None);
        }

        let elapsed_from = rep.last_decay_at.max(rep.last_task_completed_at);
        let weeks_elapsed = now.saturating_sub(elapsed_from) / SECONDS_PER_WEEK;
        if weeks_elapsed == 0 {
            return Ok(None);
        }

        let old_score = rep.score;
        rep.score = apply_decay(old_score, weeks_elapsed);
        rep.last_decay_at = now;
        rep.next_decay_at = now.saturating_add(SECONDS_PER_WEEK);
        save_score(env, &rep);

        Ok(Some(ReputationDecayedEvent {
            agent_id,
            old_score,
            new_score: rep.score,
            weeks_elapsed,
        }))
    }

    // ── Query functions ───────────────────────────────────────────────────────

    /// Return the full reputation record for an agent.
    pub fn get_reputation(env: Env, agent_id: Symbol) -> Result<ReputationScore, Error> {
        require_initialized(&env)?;
        read_score(&env, &agent_id).ok_or(Error::AgentNotFound)
    }

    /// Return the current score for an agent (scaled ×100).
    pub fn get_score(env: Env, agent_id: Symbol) -> i64 {
        read_score(&env, &agent_id)
            .map(|r| r.score)
            .unwrap_or(INITIAL_SCORE)
    }

    /// Return the list of authorized callers.
    pub fn get_authorized_callers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedCallers)
            .unwrap_or_else(|| Vec::new(&env))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        Address, Env, IntoVal, Symbol,
    };

    fn make_fixture() -> (Env, ReputationContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);
        let contract_id = env.register(ReputationContract, ());
        let client = ReputationContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let task_store = Address::generate(&env);
        client.initialize(&admin);
        client.add_authorized_caller(&task_store);
        (env, client, admin, task_store)
    }

    fn agent(env: &Env) -> Symbol {
        Symbol::new(env, "agent1")
    }

    fn task(env: &Env) -> Symbol {
        Symbol::new(env, "task1")
    }

    // ── record_outcome ────────────────────────────────────────────────────────

    #[test]
    fn success_increases_score() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &true, &0u32);
        let rep = client.get_reputation(&a);
        // Initial 50.00 (5_000) + 10.00 (1_000) = 60.00 (6_000)
        assert_eq!(rep.score, INITIAL_SCORE + SUCCESS_POINTS);
    }

    #[test]
    fn failure_decreases_score() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &false, &0u32);
        let rep = client.get_reputation(&a);
        // Initial 50.00 (5_000) - 20.00 (2_000) = 30.00 (3_000)
        assert_eq!(rep.score, INITIAL_SCORE - FAILURE_POINTS);
    }

    #[test]
    fn five_star_applies_multiplier() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &true, &5u32);
        let rep = client.get_reputation(&a);
        // 10.00 × 1.5 = 15.00 (1_500 scaled)
        let expected = INITIAL_SCORE + SUCCESS_POINTS * FIVE_STAR_MULTIPLIER_BPS / 100;
        assert_eq!(rep.score, expected);
    }

    #[test]
    fn score_cannot_go_below_zero() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        // Record 100 failures: 100 × 2_000 = 200_000 >> INITIAL_SCORE (5_000).
        for _ in 0..100u32 {
            client.record_outcome(&caller, &a, &task(&env), &false, &0u32);
        }
        let rep = client.get_reputation(&a);
        assert_eq!(rep.score, 0);
    }

    #[test]
    fn unauthorized_caller_rejected() {
        let (env, client, _, _) = make_fixture();
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_record_outcome(&stranger, &agent(&env), &task(&env), &true, &0u32),
            Err(Ok(Error::Unauthorized))
        );
    }

    #[test]
    fn invalid_rating_rejected() {
        let (env, client, _, caller) = make_fixture();
        assert_eq!(
            client.try_record_outcome(&caller, &agent(&env), &task(&env), &true, &6u32),
            Err(Ok(Error::InvalidRating))
        );
    }

    #[test]
    fn outcome_emits_event() {
        let (env, client, _, caller) = make_fixture();
        client.record_outcome(&caller, &agent(&env), &task(&env), &true, &3u32);
        let events = env.events().all();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events.get(0).unwrap().1,
            (symbol_short!("reputat"), symbol_short!("outcome")).into_val(&env)
        );
    }

    // ── decay_reputation ──────────────────────────────────────────────────────

    #[test]
    fn decay_applies_after_one_week() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &true, &0u32);
        let before = client.get_reputation(&a).score;

        // Advance 1 week + 1 second.
        env.ledger()
            .with_mut(|l| l.timestamp += SECONDS_PER_WEEK + 1);
        client.decay_reputation(&a);

        let after = client.get_reputation(&a).score;
        // Expect 5 % reduction.
        let expected = before * (10_000 - DECAY_RATE_BPS) / 10_000;
        assert_eq!(after, expected);
    }

    #[test]
    fn decay_emits_event() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &true, &0u32);
        env.ledger()
            .with_mut(|l| l.timestamp += SECONDS_PER_WEEK + 1);
        client.decay_reputation(&a);
        let events = env.events().all();
        let last = events.last().unwrap();
        assert_eq!(
            last.1,
            (symbol_short!("reputat"), symbol_short!("decayed")).into_val(&env)
        );
    }

    #[test]
    fn no_decay_before_one_week() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &true, &0u32);
        let before = client.get_reputation(&a).score;

        // Less than 1 week elapsed.
        env.ledger()
            .with_mut(|l| l.timestamp += SECONDS_PER_WEEK - 1);
        client.decay_reputation(&a);

        assert_eq!(client.get_reputation(&a).score, before);
    }

    #[test]
    fn multi_week_compound_decay() {
        let (env, client, _, caller) = make_fixture();
        let a = agent(&env);
        client.record_outcome(&caller, &a, &task(&env), &true, &0u32);
        let before = client.get_reputation(&a).score;

        env.ledger()
            .with_mut(|l| l.timestamp += 3 * SECONDS_PER_WEEK + 1);
        client.decay_reputation(&a);
        let after = client.get_reputation(&a).score;
        let expected = apply_decay(before, 3);
        assert_eq!(after, expected);
    }

    #[test]
    fn heartbeat_applies_exact_periods_and_floor() {
        for (periods, expected) in [(1, 5_700), (2, 5_415), (3, 5_144), (500, DECAY_FLOOR)] {
            let (env, client, _, caller) = make_fixture();
            let id = agent(&env);
            let address = Address::generate(&env);
            client.set_agent_address(&address, &id);
            client.record_outcome(&caller, &id, &task(&env), &true, &0);
            env.ledger()
                .with_mut(|ledger| ledger.timestamp += periods * SECONDS_PER_WEEK);
            client.apply_decay(&address);
            let last_event = env.events().all().last().unwrap();
            assert_eq!(
                DecayApplied::try_from_val(&env, &last_event.2).unwrap(),
                DecayApplied {
                    agent_id: address.clone(),
                    old_score: 6_000,
                    new_score: expected,
                }
            );
            let schedule = client.get_decay_schedule(&address);
            assert_eq!(schedule.score, expected);
            assert_eq!(
                schedule.next_decay_at,
                env.ledger().timestamp() + SECONDS_PER_WEEK
            );
            client.apply_decay(&address);
            assert_eq!(client.get_decay_schedule(&address), schedule);
        }
    }

    #[test]
    fn successful_completion_restarts_the_clock() {
        let (env, client, _, caller) = make_fixture();
        let id = agent(&env);
        let address = Address::generate(&env);
        client.set_agent_address(&address, &id);
        client.record_outcome(&caller, &id, &task(&env), &true, &0);
        env.ledger()
            .with_mut(|ledger| ledger.timestamp += SECONDS_PER_WEEK);
        client.record_outcome(&caller, &id, &task(&env), &true, &0);
        env.ledger()
            .with_mut(|ledger| ledger.timestamp += 3 * 86_400);
        client.apply_decay(&address);
        assert_eq!(client.get_decay_schedule(&address).score, 7_000);
    }

    // ── get_reputation ────────────────────────────────────────────────────────

    #[test]
    fn get_reputation_returns_not_found_for_unknown_agent() {
        let (env, client, _, _) = make_fixture();
        let unknown = Symbol::new(&env, "unknown1");
        assert_eq!(
            client.try_get_reputation(&unknown),
            Err(Ok(Error::AgentNotFound))
        );
    // ── Vesting ──────────────────────────────────────────────────────────────

    /// **Admin-only.** Create a linear vesting schedule for `agent_id`.
    ///
    /// # Arguments
    ///
    /// * `agent_id`  — the agent that will be able to claim the tokens.
    /// * `amount`    — total tokens to vest (must be > 0).
    /// * `start`     — UNIX timestamp at which vesting begins.
    /// * `duration`  — length of the vesting period in seconds (must be > 0).
    ///
    /// # Errors
    ///
    /// * [`Error::NotInitialized`]      — `initialize` has not been called.
    /// * [`Error::Unauthorized`]        — caller is not the admin.
    /// * [`Error::InvalidAmount`]       — `amount ≤ 0`.
    /// * [`Error::InvalidDuration`]     — `duration == 0`.
    /// * [`Error::VestingAlreadyExists`] — agent already has an active schedule.
    pub fn create_vesting_schedule(
        env: Env,
        agent_id: Address,
        amount: i128,
        start: u64,
        duration: u64,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        let admin = Self::load_admin(&env)?;
        // The caller must be the admin; `create_vesting_schedule` checks this.
        vesting::create_vesting_schedule(&env, &admin, &admin, agent_id, amount, start, duration)
    }

    /// Claim all currently vested tokens for `agent_id`.
    ///
    /// Returns the number of tokens transferred in this call. Returns `0` when
    /// nothing new has vested since the last claim (idempotent for the same
    /// ledger).
    ///
    /// # Errors
    ///
    /// * [`Error::VestingNotFound`]   — no schedule exists for this agent.
    /// * [`Error::VestingNotStarted`] — `ledger().timestamp() < start_timestamp`.
    pub fn claim_vested(env: Env, agent_id: Address) -> Result<i128, Error> {
        Self::require_initialized(&env)?;
        vesting::claim_vested(&env, agent_id)
    }

    /// Return the vesting schedule and currently claimable amount for `agent_id`.
    ///
    /// Returns `claimable = 0` when vesting has not yet started, so callers can
    /// inspect the schedule freely without an error.
    ///
    /// # Errors
    ///
    /// * [`Error::VestingNotFound`] — no schedule exists for this agent.
    pub fn get_vesting_state(env: Env, agent_id: Address) -> Result<VestingState, Error> {
        Self::require_initialized(&env)?;
        vesting::get_vesting_state(&env, agent_id)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            Ok(())
        } else {
            Err(Error::NotInitialized)
        }
    }

    fn load_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}
