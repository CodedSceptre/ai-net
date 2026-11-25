//! # Agent Marketplace Unit Tests

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Symbol,
};

fn setup() -> (Env, AgentMarketplaceContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AgentMarketplaceContract, ());
    let client = AgentMarketplaceContractClient::new(&env, &id);
    (env, client)
}

fn setup_with_admin() -> (Env, AgentMarketplaceContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AgentMarketplaceContract, ());
    let client = AgentMarketplaceContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
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
fn list_service_duplicate() {
    let (env, client) = setup();
    let owner = Address::generate(&env);

    client.list_service(
        &Symbol::new(&env, "svc1"),
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "research"),
        &1_000_000_i128,
        &200_u32,
        &24_u32,
    );

    assert_eq!(
        client.try_list_service(
            &Symbol::new(&env, "svc1"),
            &Symbol::new(&env, "agent2"),
            &owner,
            &Symbol::new(&env, "coding"),
            &2_000_000_i128,
            &100_u32,
            &12_u32,
        ),
        Err(Ok(Error::AlreadyExists))
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

    let results = client.search_services(&Symbol::new(&env, "research"), &1_000_000_i128, &0_u32);
    assert_eq!(results.len(), 1);
    assert_eq!(
        results.get(0).unwrap().listing_id,
        Symbol::new(&env, "svc_cheap")
    );
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

#[test]
fn book_agent_insufficient_payment() {
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

    assert_eq!(
        client.try_book_agent(
            &Symbol::new(&env, "svc1"),
            &client_addr,
            &500_000_i128,
            &Symbol::new(&env, "bk_bad"),
        ),
        Err(Ok(Error::InsufficientPayment))
    );
}

#[test]
fn complete_booking_releases_escrow() {
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

    client.complete_booking(&booking_id);

    let booking = client.get_booking(&booking_id).unwrap();
    assert!(booking.completed);
}

#[test]
fn cancel_booking_refunds_client() {
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

    client.cancel_booking(&booking_id);

    let booking = client.get_booking(&booking_id).unwrap();
    assert!(booking.cancelled);
}

#[test]
fn rate_booking_updates_agent_rating() {
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
    client.complete_booking(&booking_id);
    client.rate_booking(&booking_id, &5);

    let rating = client.get_agent_rating(&Symbol::new(&env, "agent1"));
    assert_eq!(rating.total_ratings, 1);
    assert_eq!(rating.rating_sum, 5);
}

#[test]
fn rate_invalid_score() {
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
    client.complete_booking(&booking_id);

    assert_eq!(
        client.try_rate_booking(&booking_id, &0),
        Err(Ok(Error::InvalidPrice))
    );
    assert_eq!(
        client.try_rate_booking(&booking_id, &6),
        Err(Ok(Error::InvalidPrice))
    );
}

#[test]
fn pause_blocks_listing() {
    let (env, client, _admin) = setup_with_admin();
    client.pause(&true);

    let owner = Address::generate(&env);
    assert_eq!(
        client.try_list_service(
            &Symbol::new(&env, "svc1"),
            &Symbol::new(&env, "agent1"),
            &owner,
            &Symbol::new(&env, "research"),
            &1_000_000_i128,
            &200_u32,
            &24_u32,
        ),
        Err(Ok(Error::ContractPaused))
    );
}

// ── Listing Expiry, Renewal & Metadata Tests (Issue #411) ────────────────────

#[test]
fn listing_expiry_and_grace_period_purging() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let listing_id = Symbol::new(&env, "expiring_svc");

    client.list_service(
        &listing_id,
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "compute"),
        &500_000_i128,
        &100_u32,
        &12_u32,
    );

    let l = client.get_listing(&listing_id).unwrap();
    assert!(l.active);
    assert_eq!(l.status, Symbol::new(&env, "active"));

    // Advance ledger past expiry (30 days) but before grace period (7 days)
    env.ledger().with_mut(|li| {
        li.sequence_number = l.expiry_ledger + 10;
    });

    let expired = client.get_listing(&listing_id).unwrap();
    assert!(!expired.active);
    assert_eq!(expired.status, Symbol::new(&env, "expired"));

    // Advance ledger past grace period
    env.ledger().with_mut(|li| {
        li.sequence_number = l.expiry_ledger + GRACE_PERIOD_LEDGERS + 100;
    });

    // Should be purged completely from storage
    assert!(client.get_listing(&listing_id).is_none());
}

#[test]
fn renew_listing_extends_validity() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let listing_id = Symbol::new(&env, "renewable_svc");

    client.list_service(
        &listing_id,
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "compute"),
        &500_000_i128,
        &100_u32,
        &12_u32,
    );

    let initial = client.get_listing(&listing_id).unwrap();

    // Advance 10,000 ledgers
    env.ledger().with_mut(|li| {
        li.sequence_number += 10_000;
    });

    client.renew_listing(&listing_id);

    let renewed = client.get_listing(&listing_id).unwrap();
    assert!(renewed.expiry_ledger > initial.expiry_ledger);
    assert!(renewed.active);
    assert_eq!(renewed.status, Symbol::new(&env, "active"));
}

#[test]
fn update_listing_metadata_preserves_position() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let listing_id = Symbol::new(&env, "meta_svc");

    client.list_service(
        &listing_id,
        &Symbol::new(&env, "agent1"),
        &owner,
        &Symbol::new(&env, "nlp"),
        &1_000_000_i128,
        &300_u32,
        &24_u32,
    );

    let new_desc = Symbol::new(&env, "advanced_nlp");
    client.update_listing_metadata(
        &listing_id,
        &Some(2_000_000_i128),
        &Some(new_desc.clone()),
        &Some(150_u32),
        &Some(12_u32),
    );

    let updated = client.get_listing(&listing_id).unwrap();
    assert_eq!(updated.price_stroops, 2_000_000_i128);
    assert_eq!(updated.description, new_desc);
    assert_eq!(updated.max_response_time, 150_u32);
    assert_eq!(updated.availability_hours, 12_u32);
    assert!(updated.active);
}

#[test]
fn auction_refunds_outbid_client_and_pays_agent_at_expiry() {
    let (env, client, admin) = setup_with_admin();
    let asset = env.register_stellar_asset_contract_v2(admin).address();
    client.set_auction_token(&asset);
    let mint = token::StellarAssetClient::new(&env, &asset);
    let token = token::Client::new(&env, &asset);
    let agent = Address::generate(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);
    mint.mint(&first, &200);
    mint.mint(&second, &200);

    let auction = client.create_auction(&agent, &String::from_str(&env, "audit"), &101, &2);
    client.place_bid(&auction, &first, &101);
    assert_eq!(token.balance(&first), 99);
    assert_eq!(
        client.try_place_bid(&auction, &second, &106),
        Err(Ok(Error::BidTooLow))
    );
    client.place_bid(&auction, &second, &107);
    assert_eq!(token.balance(&first), 200);
    assert_eq!(token.balance(&second), 93);
    assert_eq!(
        client.try_finalize_auction(&auction),
        Err(Ok(Error::AuctionNotExpired))
    );

    let expiry = client.get_auction(&auction).unwrap().expires_at_ledger;
    env.ledger()
        .with_mut(|ledger| ledger.sequence_number = expiry);
    assert_eq!(
        client.try_place_bid(&auction, &first, &200),
        Err(Ok(Error::AuctionExpired))
    );
    client.finalize_auction(&auction);
    assert_eq!(token.balance(&agent), 107);
    assert_eq!(client.get_auction_slot_holder(&auction), Some(second));
    assert_eq!(
        client.try_finalize_auction(&auction),
        Err(Ok(Error::AuctionAlreadyFinalized))
    );
}

#[test]
fn no_bid_auction_returns_slot_to_agent() {
    let (env, client, admin) = setup_with_admin();
    let asset = env.register_stellar_asset_contract_v2(admin).address();
    client.set_auction_token(&asset);
    let agent = Address::generate(&env);
    let auction = client.create_auction(&agent, &String::from_str(&env, "audit"), &100, &1);
    env.ledger().with_mut(|ledger| ledger.sequence_number += 1);

    client.finalize_auction(&auction);
    assert!(client.get_auction(&auction).unwrap().finalized);
    assert_eq!(client.get_auction_slot_holder(&auction), Some(agent));
}
