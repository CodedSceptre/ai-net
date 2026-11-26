#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    BytesN, Env, String,
};

fn setup() -> (Env, DisputeResolutionContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(DisputeResolutionContract, ());
    let client = DisputeResolutionContractClient::new(&env, &id);
    (env, client)
}

fn five_arbiters(env: &Env) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..5 {
        v.push_back(Address::generate(env));
    }
    v
}

fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn fund_task(
    env: &Env,
    client: &DisputeResolutionContractClient,
    submitter: &Address,
    task_id: &Symbol,
    completed_at: u64,
) -> (Address, Address) {
    let token_admin = Address::generate(env);
    let asset = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let token = token::StellarAssetClient::new(env, &asset);
    token.mint(submitter, &20_000_000);
    let agent = Address::generate(env);
    client.fund_task_escrow(
        submitter,
        task_id,
        &agent,
        &asset,
        &10_000_000,
        &completed_at,
    );
    (asset, agent)
}

// ─── Initialization ───────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    assert!(client.try_initialize(&admin).is_err());
}

// ─── raise_dispute ────────────────────────────────────────────────────────────

#[test]
fn test_raise_dispute_returns_id() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.set_arbiters(&five_arbiters(&env));

    let submitter = Address::generate(&env);
    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    fund_task(&env, &client, &submitter, &symbol_short!("task1"), now);

    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("task1"),
        &zero_hash(&env),
        &String::from_str(&env, "not delivered"),
    );
    assert_eq!(id, 1u64);
}

#[test]
fn test_raise_dispute_too_late() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.set_arbiters(&five_arbiters(&env));

    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    // task completed 25 hours ago — outside 24-hour window
    let completed_at = now - (25 * 3600);
    let submitter = Address::generate(&env);
    fund_task(
        &env,
        &client,
        &submitter,
        &symbol_short!("task1"),
        completed_at,
    );

    let result = client.try_raise_dispute(
        &submitter,
        &symbol_short!("task1"),
        &zero_hash(&env),
        &String::from_str(&env, "late"),
    );
    assert!(result.is_err());
}

#[test]
fn test_raise_dispute_no_arbiters_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    // no arbiters set

    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("task1"), now);

    let result = client.try_raise_dispute(
        &submitter,
        &symbol_short!("task1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );
    assert!(result.is_err());
}

#[test]
fn test_undisputed_escrow_releases_to_agent_after_raise_window() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let submitter = Address::generate(&env);
    let completed_at = 1_000_000u64;
    env.ledger().set_timestamp(completed_at);
    let (asset, agent) = fund_task(
        &env,
        &client,
        &submitter,
        &symbol_short!("ordinary"),
        completed_at,
    );

    assert!(client
        .try_settle_undisputed_task(&symbol_short!("ordinary"))
        .is_err());
    env.ledger().set_timestamp(completed_at + RAISE_WINDOW_SECS);
    client.settle_undisputed_task(&symbol_short!("ordinary"));

    let token = token::Client::new(&env, &asset);
    assert_eq!(token.balance(&agent), 10_000_000);
    assert!(client
        .try_settle_undisputed_task(&symbol_short!("ordinary"))
        .is_err());
}

// ─── vote_on_dispute ──────────────────────────────────────────────────────────

#[test]
fn test_arbiter_votes_recorded() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let arbiters = five_arbiters(&env);
    client.set_arbiters(&arbiters);

    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("t1"), now);

    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    client.vote_on_dispute(&arbiters.get(0).unwrap(), &id, &Vote::Approve);
    client.vote_on_dispute(&arbiters.get(1).unwrap(), &id, &Vote::Approve);
    client.vote_on_dispute(&arbiters.get(2).unwrap(), &id, &Vote::Reject);

    let rec = client.get_dispute(&id).unwrap();
    assert_eq!(rec.approve_votes, 2);
    assert_eq!(rec.reject_votes, 1);
}

#[test]
fn test_non_arbiter_cannot_vote() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.set_arbiters(&five_arbiters(&env));

    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("t1"), now);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    let stranger = Address::generate(&env);
    assert!(client
        .try_vote_on_dispute(&stranger, &id, &Vote::Approve)
        .is_err());
}

#[test]
fn test_arbiter_cannot_vote_twice() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let arbiters = five_arbiters(&env);
    client.set_arbiters(&arbiters);

    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("t1"), now);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    client.vote_on_dispute(&arbiters.get(0).unwrap(), &id, &Vote::Approve);
    assert!(client
        .try_vote_on_dispute(&arbiters.get(0).unwrap(), &id, &Vote::Reject)
        .is_err());
}

#[test]
fn test_task_cannot_be_disputed_twice() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.set_arbiters(&five_arbiters(&env));

    let completed_at = 1_000_000u64;
    env.ledger().set_timestamp(completed_at);
    let submitter = Address::generate(&env);
    fund_task(
        &env,
        &client,
        &submitter,
        &symbol_short!("onecase"),
        completed_at,
    );
    client.raise_dispute(
        &submitter,
        &symbol_short!("onecase"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );
    assert!(client
        .try_raise_dispute(
            &submitter,
            &symbol_short!("onecase"),
            &zero_hash(&env),
            &String::from_str(&env, "second dispute"),
        )
        .is_err());
}

#[test]
fn test_cannot_vote_after_deadline() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let arbiters = five_arbiters(&env);
    client.set_arbiters(&arbiters);

    let start = 1_000_000u64;
    env.ledger().set_timestamp(start);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("t1"), start);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    // Advance past 72-hour voting deadline
    env.ledger().set_timestamp(start + VOTING_PERIOD_SECS + 1);
    assert!(client
        .try_vote_on_dispute(&arbiters.get(0).unwrap(), &id, &Vote::Approve)
        .is_err());
}

// ─── resolve_dispute ──────────────────────────────────────────────────────────

#[test]
fn test_resolve_approve_3_of_5() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let arbiters = five_arbiters(&env);
    client.set_arbiters(&arbiters);

    let start = 1_000_000u64;
    env.ledger().set_timestamp(start);
    let submitter = Address::generate(&env);
    let (asset, agent) = fund_task(&env, &client, &submitter, &symbol_short!("t1"), start);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    // 3 approve, 2 reject
    client.vote_on_dispute(&arbiters.get(0).unwrap(), &id, &Vote::Approve);
    client.vote_on_dispute(&arbiters.get(1).unwrap(), &id, &Vote::Approve);
    client.vote_on_dispute(&arbiters.get(2).unwrap(), &id, &Vote::Approve);
    client.vote_on_dispute(&arbiters.get(3).unwrap(), &id, &Vote::Reject);
    client.vote_on_dispute(&arbiters.get(4).unwrap(), &id, &Vote::Reject);

    env.ledger().set_timestamp(start + VOTING_PERIOD_SECS + 1);
    let resolution = client.resolve_dispute(&id);
    assert_eq!(resolution, Resolution::Approve);

    let rec = client.get_dispute(&id).unwrap();
    assert_eq!(rec.status, DisputeStatus::Resolved);
    assert_eq!(rec.resolution, Some(Resolution::Approve as u32));
    let token = token::Client::new(&env, &asset);
    assert_eq!(token.balance(&agent), 10_000_000);
}

#[test]
fn test_resolve_reject_below_threshold() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let arbiters = five_arbiters(&env);
    client.set_arbiters(&arbiters);

    let start = 1_000_000u64;
    env.ledger().set_timestamp(start);
    let submitter = Address::generate(&env);
    let (asset, _) = fund_task(&env, &client, &submitter, &symbol_short!("t1"), start);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    // Only 2 approve votes — below 3-of-5 threshold
    client.vote_on_dispute(&arbiters.get(0).unwrap(), &id, &Vote::Approve);
    client.vote_on_dispute(&arbiters.get(1).unwrap(), &id, &Vote::Approve);

    env.ledger().set_timestamp(start + VOTING_PERIOD_SECS + 1);
    let resolution = client.resolve_dispute(&id);
    assert_eq!(resolution, Resolution::Reject);
    let token = token::Client::new(&env, &asset);
    assert_eq!(token.balance(&submitter), 20_000_000);
}

#[test]
fn test_resolve_before_deadline_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.set_arbiters(&five_arbiters(&env));

    let now = 1_000_000u64;
    env.ledger().set_timestamp(now);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("t1"), now);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    // Still within voting period
    assert!(client.try_resolve_dispute(&id).is_err());
}

#[test]
fn test_resolve_twice_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.set_arbiters(&five_arbiters(&env));

    let start = 1_000_000u64;
    env.ledger().set_timestamp(start);
    let submitter = Address::generate(&env);
    fund_task(&env, &client, &submitter, &symbol_short!("t1"), start);
    let id = client.raise_dispute(
        &submitter,
        &symbol_short!("t1"),
        &zero_hash(&env),
        &String::from_str(&env, "reason"),
    );

    env.ledger().set_timestamp(start + VOTING_PERIOD_SECS + 1);
    client.resolve_dispute(&id);
    assert!(client.try_resolve_dispute(&id).is_err());
}

// ─── get_dispute ─────────────────────────────────────────────────────────────

#[test]
fn test_get_dispute_nonexistent_returns_none() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    assert!(client.get_dispute(&999u64).is_none());
}

// ─── is_arbiter helper ────────────────────────────────────────────────────────

#[test]
fn test_is_arbiter() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let arbiters = five_arbiters(&env);
    client.set_arbiters(&arbiters);

    assert!(client.is_arbiter(&arbiters.get(0).unwrap()));
    assert!(!client.is_arbiter(&Address::generate(&env)));
}
