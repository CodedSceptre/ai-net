//! # Agent Marketplace Unit Tests

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env, Symbol, Vec,
};

fn setup() -> (Env, AgentMarketplaceContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AgentMarketplaceContract, ());
    let client = AgentMarketplaceContractClient::new(&env, &id);
    (env, client)
}

#[test]
fn initialize_sets_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    assert!(env.storage().instance().has(&DataKey::Admin));
}

#[test]
fn initialize_cannot_be_called_twice() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.initialize(&admin);
    assert_eq!(
        client.try_initialize(&Address::generate(&env)),
        Err(Ok(Error::AlreadyExists))
    );
}

#[test]
fn list_service_success() {
    let (env, client) = setup();
    let owner = Address::generate(&env);

    let result = client.try_list_service(
        &Symbol::new(&env, "svc1"),
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "research"),
        &1_000_000_i128,
        &200_u32,
        &24_u32,
    );
    assert!(result.is_ok());

    let listing = client.get_listing(&Symbol::new(&env, "svc1"));
    assert!(listing.is_some());
    let listing = listing.unwrap();
    assert_eq!(listing.price_stroops, 1_000_000);
    assert!(listing.active);
}

#[test]
fn list_service_invalid_price() {
    let (env, client) = setup();
    let owner = Address::generate(&env);

    assert_eq!(
        client.try_list_service(
            &Symbol::new(&env, "svc_bad"),
            &Symbol::new(&env, "agent1"),
            &owner,
            &Symbol::new(&env, "research"),
            &0_i128,
            &200_u32,
            &24_u32,
        ),
        Err(Ok(Error::InvalidPrice))
    );
}

#[test]
fn search_services_filters_by_price() {
    let (env, client) = setup();
    let owner = Address::generate(&env);

    client.list_service(
        &Symbol::new(&env, "svc_cheap"),
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "research"),
        &500_000_i128,
        &200_u32,
        &24_u32,
    );
    client.list_service(
        &Symbol::new(&env, "svc_expensive"),
        &Symbol::new(&env, "agent2"),
        &owner,
        &Symbol::new(&env, "research"),
        &2_000_000_i128,
        &200_u32,
        &24_u32,
    );

    let results = client.search_services(
        &Symbol::new(&env, "research"),
        &1_000_000_i128,
        &0_u32,
    );
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().listing_id, Symbol::new(&env, "svc_cheap"));
}

#[test]
fn book_agent_success() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let client_addr = Address::generate(&env);

    client.list_service(
        &Symbol::new(&env, "svc1"),
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "research"),
        &1_000_000_i128,
        &200_u32,
        &24_u32,
    );

    let booking_id = Symbol::new(&env, "bk1");
    client.book_agent(
        &Symbol::new(&env, "svc1"),
        &client_addr,
        &1_000_000_i128,
        &booking_id,
    );

    let booking = client.get_booking(&booking_id);
    assert!(booking.is_some());
    let booking = booking.unwrap();
    assert_eq!(booking.escrow_amount, 1_000_000);
    assert!(!booking.completed);
    assert!(!booking.cancelled);
}

// ── Capability Search with Scoring & Pagination Tests (Issue #419) ───────────

#[test]
fn test_search_by_capabilities_multi_tag_and_scoring() {
    let (env, client) = setup();
    let owner1 = Address::generate(&env);
    let owner2 = Address::generate(&env);
    let owner3 = Address::generate(&env);

    let tag_nlp = Bytes::from_slice(&env, b"nlp");
    let tag_code = Bytes::from_slice(&env, b"code");
    let tag_data = Bytes::from_slice(&env, b"data");

    // Agent 1: has nlp, code, data. Reputation = 95
    let mut caps1 = Vec::new(&env);
    caps1.push_back(tag_nlp.clone());
    caps1.push_back(tag_code.clone());
    caps1.push_back(tag_data.clone());
    client.register_agent_profile(
        &Symbol::new(&env, "agent1"),
        &owner1,
        &caps1,
        &95,
    );

    // Agent 2: has nlp, code, data. Reputation = 80
    let mut caps2 = Vec::new(&env);
    caps2.push_back(tag_nlp.clone());
    caps2.push_back(tag_code.clone());
    caps2.push_back(tag_data.clone());
    client.register_agent_profile(
        &Symbol::new(&env, "agent2"),
        &owner2,
        &caps2,
        &80,
    );

    // Agent 3: has ONLY nlp and code (missing data). Reputation = 99
    let mut caps3 = Vec::new(&env);
    caps3.push_back(tag_nlp.clone());
    caps3.push_back(tag_code.clone());
    client.register_agent_profile(
        &Symbol::new(&env, "agent3"),
        &owner3,
        &caps3,
        &99,
    );

    // Multi-capability search for [nlp, code, data] (AND logic)
    let mut search_caps = Vec::new(&env);
    search_caps.push_back(tag_nlp.clone());
    search_caps.push_back(tag_code.clone());
    search_caps.push_back(tag_data.clone());

    let result = client.search_by_capabilities(&search_caps, &None, &20);
    // Agent 3 should NOT match because it is missing "data"
    assert_eq!(result.total_count_estimate, 2);
    assert_eq!(result.agents.len(), 2);

    // Should be ordered by reputation descending: agent1 (95) then agent2 (80)
    assert_eq!(result.agents.get(0).unwrap().agent_id, Symbol::new(&env, "agent1"));
    assert_eq!(result.agents.get(0).unwrap().reputation_score, 95);
    assert_eq!(result.agents.get(1).unwrap().agent_id, Symbol::new(&env, "agent2"));
    assert_eq!(result.agents.get(1).unwrap().reputation_score, 80);
}

#[test]
fn test_search_by_capability_single_and_pagination() {
    let (env, client) = setup();
    let tag = Bytes::from_slice(&env, b"finance");

    for i in 1..=5 {
        let owner = Address::generate(&env);
        let mut caps = Vec::new(&env);
        caps.push_back(tag.clone());
        let mut name_buf = [0u8; 6];
        name_buf[..5].copy_from_slice(b"agnt_");
        name_buf[5] = b'0' + i as u8;
        let name_sym = Symbol::new(&env, core::str::from_utf8(&name_buf).unwrap());
        client.register_agent_profile(&name_sym, &owner, &caps, &(i * 10));
    }

    // Page 1: limit 2
    let page1 = client.search_by_capability(&tag, &None, &2);
    assert_eq!(page1.agents.len(), 2);
    assert!(page1.next_cursor.is_some());

    // Page 2: with cursor from page 1
    let page2 = client.search_by_capability(&tag, &page1.next_cursor, &2);
    assert_eq!(page2.agents.len(), 2);
    assert!(page2.next_cursor.is_some());

    // Page 3: last agent
    let page3 = client.search_by_capability(&tag, &page2.next_cursor, &2);
    assert_eq!(page3.agents.len(), 1);
    assert_eq!(page3.next_cursor, None); // Last page has None cursor
}
