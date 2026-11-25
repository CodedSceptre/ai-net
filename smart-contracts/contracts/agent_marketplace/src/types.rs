//! # Data Types for Agent Marketplace

use soroban_sdk::{contracttype, Address, Bytes, String, Symbol, Vec};

pub const DEFAULT_LISTING_DURATION_LEDGERS: u32 = 518_400; // ~30 days at 5s/ledger
pub const GRACE_PERIOD_LEDGERS: u32 = 120_960; // ~7 days at 5s/ledger

/// On-chain representation of a service listing.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceListing {
    /// Unique listing identifier.
    pub listing_id: Symbol,
    /// Agent offering this service.
    pub agent_id: Symbol,
    /// Owner of the agent.
    pub owner: Address,
    /// Capability category being offered.
    pub capability: Symbol,
    /// Price per service unit in stroops.
    pub price_stroops: i128,
    /// Maximum response time SLA in milliseconds.
    pub max_response_time: u32,
    /// Availability hours (0-24).
    pub availability_hours: u32,
    /// Whether the listing is currently active.
    pub active: bool,
    /// Ledger sequence when the listing expires.
    pub expiry_ledger: u32,
    /// Status: "active", "expired", etc.
    pub status: Symbol,
    /// Listing description metadata.
    pub description: Symbol,
}

/// A service booking between a client and agent.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Booking {
    /// Unique booking identifier.
    pub booking_id: Symbol,
    /// Reference to the service listing.
    pub listing_id: Symbol,
    /// Agent providing the service.
    pub agent_id: Symbol,
    /// Client who booked the service.
    pub client: Address,
    /// Payment amount held in escrow (stroops).
    pub escrow_amount: i128,
    /// Timestamp when booking was created.
    pub created_at: u64,
    /// Whether the booking has been completed.
    pub completed: bool,
    /// Whether the booking was cancelled.
    pub cancelled: bool,
    /// Client rating after completion (0 = unrated, 1-5 = rating).
    pub rating: u32,
}

/// Agent rating record stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentRating {
    /// Agent being rated.
    pub agent_id: Symbol,
    /// Total number of ratings received.
    pub total_ratings: u64,
    /// Sum of all ratings (for computing average).
    pub rating_sum: u64,
}

/// Event data for service listing.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ServiceListedEvent {
    pub listing_id: Symbol,
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub price_stroops: i128,
}

/// Event data for service booking.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ServiceBookedEvent {
    pub booking_id: Symbol,
    pub listing_id: Symbol,
    pub client: Address,
    pub escrow_amount: i128,
}

/// Event data for service completion.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ServiceCompletedEvent {
    pub booking_id: Symbol,
    pub payment_released: i128,
}

/// Event data for service cancellation.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ServiceCancelledEvent {
    pub booking_id: Symbol,
    pub refund_amount: i128,
}

/// Event data for listing expiry.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ListingExpiredEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub expiry_ledger: u32,
}

/// Event data for listing renewal.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ListingRenewedEvent {
    pub agent_id: Symbol,
    pub new_expiry_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionListing {
    pub agent_id: Address,
    pub capability: String,
    pub start_price: i128,
    pub current_highest_bid: i128,
    pub current_highest_bidder: Option<Address>,
    pub expires_at_ledger: u32,
    pub finalized: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionCreated {
    pub auction_id: Bytes,
    pub listing: AuctionListing,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidPlaced {
    pub auction_id: Bytes,
    pub bidder: Address,
    pub bid_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionFinalized {
    pub auction_id: Bytes,
    pub slot_holder: Address,
    pub winning_bid: i128,
}

/// An agent profile returned by a capability search.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentSearchResult {
    pub agent_id: Symbol,
    pub owner: Address,
    pub capabilities: Vec<Bytes>,
    pub reputation_score: u32,
}

/// A paginated result from the capability search API.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilitySearchResult {
    pub agents: Vec<AgentSearchResult>,
    pub next_cursor: Option<Bytes>,
    pub total_count_estimate: u32,
}
