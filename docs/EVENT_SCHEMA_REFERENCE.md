# Event schema reference

- [On-chain events](#on-chain-events)
- [Off-chain events](#off-chain-events)
- [Schema versioning](#schema-versioning)
- [Combined JavaScript example](#combined-javascript-example)

## On-chain events

Use Stellar RPC [`getEvents`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents) to filter Soroban contract events. Horizon [streams transactions, operations, and other supported resources over SSE](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/streaming). Its public API has no Soroban `/events` endpoint with topic filters.

### Topic filters and pagination

Each catalog heading lists the indexed symbol topics in order, from position 0. For example, `escrow, released` indexes `escrow` at position 0 and `released` at position 1. Filter with the network-specific contract ID and the base64 XDR of each symbol. Fields in the event body, including IDs and addresses, require client-side filtering. Topic matches are case-sensitive. Use `*` for one topic slot and `**` at the end for zero or more slots.

The following filters can each be passed to `getEvents` as shown in the JavaScript example.

| Contract ID to select | Exact topic list before XDR encoding |
| --- | --- |
| Payment escrow | `["escrow", "released"]` |
| Dispute resolution | `["dispute", "raised"]` |
| Task store | `["task_meta", "created"]` |

Start at an available ledger from RPC `getHealth`. For high-volume streams, use a bounded `pagination.limit` and follow the returned `cursor` with the same filters. Omit `startLedger` and `endLedger` when supplying a cursor. Persist the cursor after processing the page, and deduplicate each record by network and event `id`. The service can return the same event again after a retry. Treat consumption as **at-least-once within retained history**, with client-owned checkpoints. Track lag against the RPC's earliest retained ledger and archive events before they expire if you need long-term replay.

### Reading the catalog

The JSON examples show a client-side normalization of the decoded RPC `value`. RPC returns base64 `ScVal` XDR by default. Decode the value according to the Rust type. The examples render addresses as StrKeys, bytes as hex, and 64-bit and wider integers as decimal strings to preserve precision. Small integers and numbered enums are JSON numbers. Structs become objects, tuples and vectors become arrays, and unit and empty options render as `null`. Property order carries no meaning. RPC's optional unpacked XDR JSON uses its own representation.

The catalog follows the repository's 16 contract directories. A deployed version may differ from the checked-in source. Confirm the contract address and Wasm version for the network you query. Event names identify topics within the emitting contract. A publish call on a reverted path does not produce a successfully committed contract event.

### `agent_bidding`

#### `bidding, upgraded`

Emitted by `upgrade`.

Rust value type

```rust
(String, String, BytesN<32>, Address, u32)
```

```json
[
  "Example event",
  "Example event",
  "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  3
]
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, created`

Emitted by `create_auction`.

```rust
pub struct AuctionCreatedEvent {
    pub task_id: Symbol,
    pub creator: Address,
    pub duration_secs: u64,
    pub reveal_duration_secs: u64,
    pub deadline: u64,
    pub reveal_deadline: u64,
    pub reserve_price: i128,
    pub max_price: i128,
    pub bond: i128,
}
```

```json
{
  "task_id": "task_42",
  "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "duration_secs": "42",
  "reveal_duration_secs": "42",
  "deadline": "1767225600",
  "reveal_deadline": "1767225600",
  "reserve_price": "25000000",
  "max_price": "25000000",
  "bond": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, bid_sbmtd`

Emitted by `submit_bid`.

```rust
pub struct BidSubmittedEvent {
    pub task_id: Symbol,
    pub bidder: Address,
    pub bond: i128,
    pub reputation: u32,
}
```

```json
{
  "task_id": "task_42",
  "bidder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "bond": "25000000",
  "reputation": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, bid_rejected_over_budget`

Emitted by `reveal_bid`. A reveal exceeds the auction maximum budget. The publish call precedes an error, so the event does not enter the successful contract event stream.

```rust
pub struct BidRejectedOverBudgetEvent {
    pub version: u32,
    pub task_id: Symbol,
    pub bidder: Address,
    pub bid_amount: i128,
    pub max_budget: i128,
    pub ledger: u32,
}
```

```json
{
  "version": 1,
  "task_id": "task_42",
  "bidder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "bid_amount": "25000000",
  "max_budget": "42",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, bid_rejected_below_reserve`

Emitted by `reveal_bid`. A reveal is below the auction reserve price. The publish call precedes an error, so the event does not enter the successful contract event stream.

```rust
pub struct BidRejectedBelowReserveEvent {
    pub version: u32,
    pub task_id: Symbol,
    pub bidder: Address,
    pub bid_amount: i128,
    pub reserve_price: i128,
    pub ledger: u32,
}
```

```json
{
  "version": 1,
  "task_id": "task_42",
  "bidder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "bid_amount": "25000000",
  "reserve_price": "25000000",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, bid_rvld`

Emitted by `reveal_bid`.

```rust
pub struct BidRevealedEvent {
    pub task_id: Symbol,
    pub bidder: Address,
    pub price_stroops: i128,
}
```

```json
{
  "task_id": "task_42",
  "bidder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "price_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, bids_rvld`

Emitted by `reveal_bids`.

```rust
pub struct BidsRevealedEvent {
    pub task_id: Symbol,
    pub revealed_count: u32,
    pub winner: Address,
    pub winning_score: i128,
    pub winning_price: i128,
}
```

```json
{
  "task_id": "task_42",
  "revealed_count": 3,
  "winner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "winning_score": "42",
  "winning_price": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, ref_claim`

Emitted by `claim_bid_refund`.

```rust
pub struct BondRefundClaimedEvent {
    pub task_id: Symbol,
    pub bidder: Address,
    pub bond: i128,
}
```

```json
{
  "task_id": "task_42",
  "bidder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "bond": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, cntrct_aw`

Emitted by `award_contract`.

```rust
pub struct ContractAwardedEvent {
    pub task_id: Symbol,
    pub winner: Address,
    pub escrow_amount: i128,
    pub refunded_bidders: u32,
    pub forfeited_bidders: u32,
}
```

```json
{
  "task_id": "task_42",
  "winner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "escrow_amount": "25000000",
  "refunded_bidders": 3,
  "forfeited_bidders": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, aborted`

Emitted by `abort_auction`.

```rust
pub struct AuctionAbortedEvent {
    pub task_id: Symbol,
    pub caller: Address,
    pub refunded_bidders: u32,
}
```

```json
{
  "task_id": "task_42",
  "caller": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "refunded_bidders": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

#### `bidding, refnd_clm`

Emitted by `claim_refund`.

```rust
pub struct RefundClaimedEvent {
    pub task_id: Symbol,
    pub bidder: Address,
    pub bond: i128,
}
```

```json
{
  "task_id": "task_42",
  "bidder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "bond": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_bidding/src/lib.rs).

### `agent_governance`

#### `gov, agent_reg`

Emitted by `register_agent`.

Rust value type

```rust
(Address, i128)
```

```json
[
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, agent_upd`

Emitted by `update_agent`.

Rust value type

```rust
(Address, i128)
```

```json
[
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, created`

Emitted by `create_proposal`.

```rust
pub struct ProposalCreatedEvent {
    pub id: u64,
    pub proposer: Address,
    pub proposal_type: ProposalType,
    pub voting_ends_at: u64,
    pub total_power_snapshot: i128,
}
```

```json
{
  "id": "42",
  "proposer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "proposal_type": 0,
  "voting_ends_at": "1767225600",
  "total_power_snapshot": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `voting_started`

Emitted by `create_proposal`.

```rust
pub struct VotingStartedEvent {
    pub proposal_id: u64,
    pub proposer: Address,
    pub voting_start_ledger: u32,
    pub voting_end_ledger: u32,
}
```

```json
{
  "proposal_id": "42",
  "proposer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "voting_start_ledger": 3,
  "voting_end_ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, vote_cast`

Emitted by `vote_on_proposal`.

```rust
pub struct VoteCastEvent {
    pub proposal_id: u64,
    pub voter: Address,
    pub choice: VoteChoice,
    pub weight: i128,
}
```

```json
{
  "proposal_id": "42",
  "voter": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "choice": 0,
  "weight": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `quorum_failed`

Emitted by `execute_proposal`. Voting has ended and turnout did not reach quorum.

```rust
pub struct QuorumFailedEvent {
    pub proposal_id: u64,
    pub total_voted: i128,
    pub quorum_needed: i128,
}
```

```json
{
  "proposal_id": "42",
  "total_voted": "42",
  "quorum_needed": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, failed`

Emitted by `execute_proposal`. Quorum was missed or the proposal did not receive enough approval.

```rust
pub struct ProposalFailedEvent {
    pub id: u64,
    pub quorum_met: bool,
    pub majority_met: bool,
    pub for_power: i128,
    pub against_power: i128,
    pub abstain_power: i128,
}
```

```json
{
  "id": "42",
  "quorum_met": true,
  "majority_met": true,
  "for_power": "25000000",
  "against_power": "25000000",
  "abstain_power": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `quorum_reached`

Emitted by `execute_proposal`. Voting has ended and turnout reached quorum.

```rust
pub struct QuorumReachedEvent {
    pub proposal_id: u64,
    pub total_voted: i128,
}
```

```json
{
  "proposal_id": "42",
  "total_voted": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, executed`

Emitted by `execute_proposal`.

```rust
pub struct ProposalExecutedEvent {
    pub id: u64,
    pub for_power: i128,
    pub against_power: i128,
    pub abstain_power: i128,
}
```

```json
{
  "id": "42",
  "for_power": "25000000",
  "against_power": "25000000",
  "abstain_power": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, chg_prop`

Emitted by `propose_change`.

```rust
pub struct ChangeProposedEvent {
    pub change_id: u32,
    pub parameter: Symbol,
    pub proposer: Address,
    pub execute_after_ledger: u32,
}
```

```json
{
  "change_id": 3,
  "parameter": "example",
  "proposer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "execute_after_ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, chg_exec`

Emitted by `execute_change`.

```rust
pub struct ChangeExecutedEvent {
    pub change_id: u32,
    pub parameter: Symbol,
    pub executor: Address,
    pub emergency: bool,
}
```

```json
{
  "change_id": 3,
  "parameter": "example",
  "executor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "emergency": true
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, chg_canc`

Emitted by `cancel_change`.

```rust
pub struct ChangeCancelledEvent {
    pub change_id: u32,
    pub parameter: Symbol,
    pub canceller: Address,
}
```

```json
{
  "change_id": 3,
  "parameter": "example",
  "canceller": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

#### `gov, grd_appr`

Emitted by `guardian_approve`.

```rust
pub struct GuardianApprovalEvent {
    pub change_id: u32,
    pub guardian: Address,
    pub total_approvals: u32,
}
```

```json
{
  "change_id": 3,
  "guardian": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "total_approvals": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_governance/src/lib.rs).

### `agent_marketplace`

#### `market, ora_set`

Emitted by `set_oracle`.

Rust value type `Address`.

```json
"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

#### `market, svc_list`

Emitted by `list_service`.

```rust
pub struct ServiceListedEvent {
    pub listing_id: Symbol,
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub price_stroops: i128,
}
```

```json
{
  "listing_id": "example",
  "agent_id": "example",
  "capability": "example",
  "price_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

#### `listing_renewed`

Emitted by `renew_listing`.

```rust
pub struct ListingRenewedEvent {
    pub agent_id: Symbol,
    pub new_expiry_ledger: u32,
}
```

```json
{
  "agent_id": "example",
  "new_expiry_ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

#### `market, svc_book`

Emitted by `book_agent`.

```rust
pub struct ServiceBookedEvent {
    pub booking_id: Symbol,
    pub listing_id: Symbol,
    pub client: Address,
    pub escrow_amount: i128,
}
```

```json
{
  "booking_id": "example",
  "listing_id": "example",
  "client": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "escrow_amount": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

#### `market, svc_comp`

Emitted by `complete_booking`.

```rust
pub struct ServiceCompletedEvent {
    pub booking_id: Symbol,
    pub payment_released: i128,
}
```

```json
{
  "booking_id": "example",
  "payment_released": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

#### `market, svc_canc`

Emitted by `cancel_booking`.

```rust
pub struct ServiceCancelledEvent {
    pub booking_id: Symbol,
    pub refund_amount: i128,
}
```

```json
{
  "booking_id": "example",
  "refund_amount": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

#### `listing_expired`

Emitted by `get_listing`. An on-chain read discovers an expired listing within its grace period. Subsequent reads can emit another notification. Simulation alone produces no committed event.

```rust
pub struct ListingExpiredEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub expiry_ledger: u32,
}
```

```json
{
  "agent_id": "example",
  "capability": "example",
  "expiry_ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_marketplace/src/lib.rs).

### `agent_registry`

#### `registry, audit`

Emitted by `record`.

```rust
pub struct AuditLogEntryEvent {
    pub seq: u64,
    pub caller: Address,
    pub operation: Symbol,
    pub amount_stroops: i128,
    pub high_value: bool,
}
```

```json
{
  "seq": "42",
  "caller": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "operation": "example",
  "amount_stroops": "25000000",
  "high_value": true
}
```

Sources [audit.rs](../smart-contracts/contracts/agent_registry/src/audit.rs).

#### `registry, anomaly`

Emitted by `emit_anomaly`.

```rust
pub struct AnomalyDetectedEvent {
    pub seq: u64,
    pub caller: Address,
    pub kind: AnomalyKind,
    pub observed: i128,
}
```

```json
{
  "seq": "42",
  "caller": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "kind": [
    "RateExceeded"
  ],
  "observed": "42"
}
```

Sources [audit.rs](../smart-contracts/contracts/agent_registry/src/audit.rs).

#### `registry, bridged`

Emitted by `issue`.

```rust
pub struct IdentityBridgedEvent {
    pub agent_id: Symbol,
    pub target_chain: TargetChain,
    pub digest: BytesN<32>,
    pub expiry: u64,
}
```

```json
{
  "agent_id": "example",
  "target_chain": [
    "Evm"
  ],
  "digest": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "expiry": "42"
}
```

Sources [bridge.rs](../smart-contracts/contracts/agent_registry/src/bridge.rs).

#### `registry, brdg_vrfy`

Emitted by `verify`.

```rust
pub struct BridgeProofVerifiedEvent {
    pub agent_id: Symbol,
    pub target_chain: TargetChain,
    pub valid: bool,
}
```

```json
{
  "agent_id": "example",
  "target_chain": [
    "Evm"
  ],
  "valid": true
}
```

Sources [bridge.rs](../smart-contracts/contracts/agent_registry/src/bridge.rs).

#### `registry, brdg_revk`

Emitted by `revoke`.

```rust
pub struct BridgeProofRevokedEvent {
    pub agent_id: Symbol,
    pub target_chain: TargetChain,
    pub revoked_by: Address,
}
```

```json
{
  "agent_id": "example",
  "target_chain": [
    "Evm"
  ],
  "revoked_by": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [bridge.rs](../smart-contracts/contracts/agent_registry/src/bridge.rs).

#### `registry, bond_slsh`

Emitted by `internal_slash_bond`, `slash_bond`.

```rust
pub struct BondSlashed {
    pub agent_id: Symbol,
    pub penalty_stroops: i128,
    pub remaining_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "penalty_stroops": "42",
  "remaining_stroops": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, init`

Emitted by `initialize`.

```rust
pub struct RegistryInitializedEvent {
    pub admin: Address,
}
```

```json
{
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, adm_chngd`

Emitted by `set_admin`, `execute_operation`.

```rust
pub struct AdminChangedEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}
```

```json
{
  "old_admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "new_admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, op_prop`

Emitted by `propose_operation`.

```rust
pub struct OperationProposed {
    pub proposal_id: u64,
    pub proposer: Address,
    pub action: Symbol,
    pub eta: u64,
    pub expires_at: u64,
}
```

```json
{
  "proposal_id": "42",
  "proposer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "action": "example",
  "eta": "1767225600",
  "expires_at": "1767225600"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, op_appr`

Emitted by `approve_operation`.

```rust
pub struct OperationApproved {
    pub proposal_id: u64,
    pub approver: Address,
}
```

```json
{
  "proposal_id": "42",
  "approver": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, paused`

Emitted by `execute_operation`, `pause`.

Rust value type `()`.

```json
null
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, unpaused`

Emitted by `execute_operation`, `unpause`.

Rust value type `()`.

```json
null
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, op_exec`

Emitted by `execute_operation`.

```rust
pub struct OperationExecuted {
    pub proposal_id: u64,
    pub executor: Address,
}
```

```json
{
  "proposal_id": "42",
  "executor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, op_canc`

Emitted by `cancel_operation`.

```rust
pub struct OperationCancelled {
    pub proposal_id: u64,
    pub canceller: Address,
}
```

```json
{
  "proposal_id": "42",
  "canceller": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, freeze`

Emitted by `freeze_agent`.

Rust value type `Symbol`.

```json
"example"
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, unfreeze`

Emitted by `unfreeze_agent`.

Rust value type `Symbol`.

```json
"example"
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, agent_reg`

Emitted by `register_agent`, `register_agents`.

```rust
pub struct AgentRegisteredEvent {
    pub agent_id: Symbol,
    pub owner: Address,
    pub capability: Symbol,
    pub price_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "owner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "capability": "example",
  "price_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, bond_lck`

Emitted by `register_agent`, `register_agents`.

```rust
pub struct BondLocked {
    pub agent_id: Symbol,
    pub owner: Address,
    pub amount_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "owner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "amount_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, disc_qry`

Emitted by `discover_agents`.

```rust
pub struct DiscoveryQueryEvent {
    pub capability: Symbol,
    pub max_price: i128,
    pub min_reputation: u32,
    pub max_latency: u32,
    pub matches_count: u32,
}
```

```json
{
  "capability": "example",
  "max_price": "25000000",
  "min_reputation": 3,
  "max_latency": 3,
  "matches_count": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, bond_ret`

Emitted by `deregister_agent`.

```rust
pub struct BondReturned {
    pub agent_id: Symbol,
    pub owner: Address,
    pub amount_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "owner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "amount_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, agent_drg`

Emitted by `deregister_agent`.

```rust
pub struct AgentDeregisteredEvent {
    pub agent_id: Symbol,
    pub owner: Address,
    pub capability: Symbol,
}
```

```json
{
  "agent_id": "example",
  "owner": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "capability": "example"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, price_upd`

Emitted by `update_pricing`.

Rust value type

```rust
(Symbol, i128)
```

```json
[
  "example",
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, err_rptd`

Emitted by `report_error`.

```rust
pub struct ErrorReportedEvent {
    pub error_id: BytesN<32>,
    pub reporter: Address,
}
```

```json
{
  "error_id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "reporter": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, err_rslvd`

Emitted by `resolve_errors`.

```rust
pub struct ErrorResolvedEvent {
    pub error_id: BytesN<32>,
    pub resolution_code: u32,
}
```

```json
{
  "error_id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "resolution_code": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, anl_rec`

Emitted by `record_task_completion`.

```rust
pub struct AnalyticsRecordedEvent {
    pub agent_id: Symbol,
    pub success: bool,
    pub response_time: u32,
    pub earnings: i128,
}
```

```json
{
  "agent_id": "example",
  "success": true,
  "response_time": 3,
  "earnings": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, lb_upd`

Emitted by `get_leaderboard`.

```rust
pub struct LeaderboardUpdatedEvent {
    pub metric: Symbol,
    pub top_count: u32,
}
```

```json
{
  "metric": "example",
  "top_count": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, sla_set`

Emitted by `set_sla`.

```rust
pub struct SlaSetEvent {
    pub agent_id: Symbol,
    pub max_response_time: u32,
    pub min_uptime: u32,
    pub min_quality_score: u32,
}
```

```json
{
  "agent_id": "example",
  "max_response_time": 3,
  "min_uptime": 3,
  "min_quality_score": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, sla_viol`

Emitted by `check_sla_compliance`.

```rust
pub struct SlaViolationDetectedEvent {
    pub agent_id: Symbol,
    pub violation_type: u32,
    pub penalty_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "violation_type": 3,
  "penalty_stroops": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `registry, sla_bonus`

Emitted by `check_sla_compliance`.

```rust
pub struct SlaBonusAwardedEvent {
    pub agent_id: Symbol,
    pub reputation_boost: u32,
}
```

```json
{
  "agent_id": "example",
  "reputation_boost": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/agent_registry/src/lib.rs).

#### `upgrade, mgr_set`

Emitted by `set_upgrade_manager`.

```rust
pub struct UpgradeManagerSetEvent {
    pub contract: Address,
    pub upgrade_manager: Address,
    pub admin: Address,
}
```

```json
{
  "contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "upgrade_manager": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [upgrade.rs](../smart-contracts/contracts/agent_registry/src/upgrade.rs).

#### `upgrade, pre_hook`

Emitted by `pre_upgrade_hook`.

```rust
pub struct PreUpgradeHookEvent {
    pub contract: Address,
    pub version: String,
    pub validation_results: Vec<String>,
    pub success: bool,
}
```

```json
{
  "contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "version": "1.1.0",
  "validation_results": [
    "Example event"
  ],
  "success": true
}
```

Sources [upgrade.rs](../smart-contracts/contracts/agent_registry/src/upgrade.rs).

#### `upgrade, post_hook`

Emitted by `post_upgrade_hook`.

```rust
pub struct PostUpgradeHookEvent {
    pub contract: Address,
    pub old_version: String,
    pub new_version: String,
    pub migration_results: Vec<String>,
    pub success: bool,
}
```

```json
{
  "contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "old_version": "1.1.0",
  "new_version": "1.1.0",
  "migration_results": [
    "Example event"
  ],
  "success": true
}
```

Sources [upgrade.rs](../smart-contracts/contracts/agent_registry/src/upgrade.rs).

#### `upgrade, initiated`

Emitted by `initiate_upgrade`.

```rust
pub struct UpgradeInitiatedEvent {
    pub contract: Address,
    pub from_version: String,
    pub to_version: String,
    pub wasm_hash: BytesN<32>,
    pub initiator: Address,
}
```

```json
{
  "contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "from_version": "1.1.0",
  "to_version": "1.1.0",
  "wasm_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "initiator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [upgrade.rs](../smart-contracts/contracts/agent_registry/src/upgrade.rs).

#### `registry, upgraded`

Emitted by `upgrade`, `upgrade_contract`.

```rust
pub struct ContractUpgradedEvent {
    pub old_version: String,
    pub new_version: String,
    pub wasm_hash: BytesN<32>,
    pub admin: Address,
    pub upgrade_ledger: u32,
}
```

```json
{
  "old_version": "1.1.0",
  "new_version": "1.1.0",
  "wasm_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "upgrade_ledger": 3
}
```

Sources [upgrade.rs](../smart-contracts/contracts/agent_registry/src/upgrade.rs).

#### `registry, rollback`

Emitted by `emergency_rollback`.

```rust
pub struct ContractRolledBackEvent {
    pub reverted_version: String,
    pub restored_version: String,
    pub admin: Address,
    pub rollback_ledger: u32,
}
```

```json
{
  "reverted_version": "1.1.0",
  "restored_version": "1.1.0",
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "rollback_ledger": 3
}
```

Sources [upgrade.rs](../smart-contracts/contracts/agent_registry/src/upgrade.rs).

### `capability_staking`

#### `staking, staked`

Emitted by `stake_bond`.

```rust
pub struct BondStakedEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub amount_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "capability": "example",
  "amount_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/capability_staking/src/lib.rs).

#### `staking, unstaked`

Emitted by `unstake_bond`.

```rust
pub struct BondUnstakedEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub amount_stroops: i128,
    pub claimable_at: u64,
}
```

```json
{
  "agent_id": "example",
  "capability": "example",
  "amount_stroops": "25000000",
  "claimable_at": "1767225600"
}
```

Sources [lib.rs](../smart-contracts/contracts/capability_staking/src/lib.rs).

#### `staking, claimed`

Emitted by `claim_unbonded`.

```rust
pub struct BondClaimedEvent {
    pub agent_id: Symbol,
    pub capability: Symbol,
    pub amount_stroops: i128,
}
```

```json
{
  "agent_id": "example",
  "capability": "example",
  "amount_stroops": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/capability_staking/src/lib.rs).

#### `staking, slashed`

Emitted by `slash_bond`.

```rust
pub struct BondSlashedEvent {
    pub agent_id: Symbol,
    pub reason: Symbol,
    pub amount_stroops: i128,
    pub treasury: Address,
}
```

```json
{
  "agent_id": "example",
  "reason": "example",
  "amount_stroops": "25000000",
  "treasury": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/capability_staking/src/lib.rs).

#### `staking, cap_slshd`

Emitted by `slash`.

```rust
pub struct CapabilitySlashedEvent {
    pub agent_id: Address,
    pub capability: Bytes,
    pub slash_amount: i128,
    pub remaining_stake: i128,
    pub ledger: u32,
}
```

```json
{
  "agent_id": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "capability": "61692d6e6574",
  "slash_amount": "25000000",
  "remaining_stake": "25000000",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/capability_staking/src/lib.rs).

### `dispute_resolution`

#### `dispute, raised`

Emitted by `raise_dispute`.

```rust
pub struct DisputeRaisedEvent {
    pub dispute_id: u64,
    pub task_id: Symbol,
    pub submitter: Address,
    pub evidence_hash: BytesN<32>,
}
```

```json
{
  "dispute_id": "42",
  "task_id": "task_42",
  "submitter": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "evidence_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
}
```

Sources [lib.rs](../smart-contracts/contracts/dispute_resolution/src/lib.rs).

#### `dispute, voted`

Emitted by `vote_on_dispute`.

```rust
pub struct DisputeVotedEvent {
    pub dispute_id: u64,
    pub arbiter: Address,
    pub vote: Vote,
}
```

```json
{
  "dispute_id": "42",
  "arbiter": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "vote": 0
}
```

Sources [lib.rs](../smart-contracts/contracts/dispute_resolution/src/lib.rs).

#### `dispute, resolved`

Emitted by `resolve_dispute`.

```rust
pub struct DisputeResolvedEvent {
    pub dispute_id: u64,
    pub resolution: Resolution,
    pub approve_votes: u32,
    pub reject_votes: u32,
}
```

```json
{
  "dispute_id": "42",
  "resolution": 0,
  "approve_votes": 3,
  "reject_votes": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/dispute_resolution/src/lib.rs).

### `error-registry`

#### `errreg, upgraded`

Emitted by `upgrade`.

Rust value type

```rust
(String, String, BytesN<32>, Address, u32)
```

```json
[
  "Example event",
  "Example event",
  "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  3
]
```

Sources [lib.rs](../smart-contracts/contracts/error-registry/src/lib.rs).

#### `errreg, submitted`

Emitted by `submit_error`.

Rust value type

```rust
(BytesN<32>, u32, u64)
```

```json
[
  "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  3,
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/error-registry/src/lib.rs).

#### `errreg, cleaned`

Emitted by `cleanup_expired_errors`.

```rust
pub struct CleanupStats {
    pub scanned: u32,
    pub removed: u32,
    pub remaining: u32,
}
```

```json
{
  "scanned": 3,
  "removed": 3,
  "remaining": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/error-registry/src/lib.rs).

### `error-resolver`

#### `errres, audit`

Emitted by `set_quorum`, `add_signer`, `remove_signer`, `propose_allowlist_op`, `execute_allowlist_op`, `add_authorized_caller`, `remove_authorized_caller`.

Rust value type

```rust
(Address, Symbol, Address, u64)
```

```json
[
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "example",
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "42"
]
```

Sources [agent_errors.rs](../smart-contracts/contracts/error-resolver/src/agent_errors.rs).

#### `errres, recorded`

Emitted by `record_error`.

Rust value type

```rust
(Symbol, u32)
```

```json
[
  "example",
  3
]
```

Sources [agent_errors.rs](../smart-contracts/contracts/error-resolver/src/agent_errors.rs).

#### `errres, cleared`

Emitted by `clear_agent_errors`.

Rust value type `Symbol`.

```json
"example"
```

Sources [agent_errors.rs](../smart-contracts/contracts/error-resolver/src/agent_errors.rs).

### `multisig_governance`

#### `GovernanceProposed`

Emitted by `propose`.

```rust
pub struct GovernanceProposedEvent {
    pub proposal_id: u64,
    pub proposer: Address,
    pub eta: u64,
    pub expires_at: u64,
}
```

```json
{
  "proposal_id": "42",
  "proposer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "eta": "1767225600",
  "expires_at": "1767225600"
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `signature_added`

Emitted by `propose`, `approve`.

```rust
pub struct SignatureAddedEvent {
    pub proposal_id: u64,
    pub signer: Address,
    pub current_count: u32,
}
```

```json
{
  "proposal_id": "42",
  "signer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "current_count": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `threshold_reached`

Emitted by `propose`, `approve`. The recorded approval count meets the applicable threshold. A proposal can emit this more than once.

```rust
pub struct ThresholdReachedEvent {
    pub proposal_id: u64,
    pub threshold: u32,
    pub ledger: u32,
}
```

```json
{
  "proposal_id": "42",
  "threshold": 3,
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `proposal_expired`

Emitted by `approve`. The approval path attempts to publish this event when the signature window has expired and then returns an error.

```rust
pub struct ProposalExpiredEvent {
    pub proposal_id: u64,
    pub ledger: u32,
}
```

```json
{
  "proposal_id": "42",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `GovernanceApproved`

Emitted by `approve`.

```rust
pub struct GovernanceApprovedEvent {
    pub proposal_id: u64,
    pub approver: Address,
    pub approval_count: u32,
}
```

```json
{
  "proposal_id": "42",
  "approver": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "approval_count": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `GovernanceRejected`

Emitted by `reject`.

```rust
pub struct GovernanceRejectedEvent {
    pub proposal_id: u64,
    pub rejector: Address,
    pub rejection_count: u32,
    pub rejected: bool,
}
```

```json
{
  "proposal_id": "42",
  "rejector": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "rejection_count": 3,
  "rejected": true
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `GovernanceExecuted`

Emitted by `execute`.

```rust
pub struct GovernanceExecutedEvent {
    pub proposal_id: u64,
    pub executor: Address,
}
```

```json
{
  "proposal_id": "42",
  "executor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `gov_ms, cancelled`

Emitted by `cancel`.

```rust
pub struct GovernanceCancelledEvent {
    pub proposal_id: u64,
    pub canceller: Address,
}
```

```json
{
  "proposal_id": "42",
  "canceller": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

#### `signature_revoked`

Emitted by `revoke`.

```rust
pub struct SignatureRevokedEvent {
    pub proposal_id: u64,
    pub signer: Address,
    pub current_count: u32,
}
```

```json
{
  "proposal_id": "42",
  "signer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "current_count": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/multisig_governance/src/lib.rs).

### `oracle_manager`

#### `mgr, ora_set`

Emitted by `set_oracle`.

```rust
pub struct OracleSetEvent {
    pub oracle: Option<Address>,
}
```

```json
{
  "oracle": null
}
```

Sources [lib.rs](../smart-contracts/contracts/oracle_manager/src/lib.rs).

#### `mgr, fb_set`

Emitted by `set_fallback_price`.

```rust
pub struct FallbackPriceSetEvent {
    pub pair: Symbol,
    pub price: i128,
}
```

```json
{
  "pair": "XLM_USD",
  "price": "25000000"
}
```

Sources [lib.rs](../smart-contracts/contracts/oracle_manager/src/lib.rs).

#### `mgr, fdr_add`

Emitted by `add_feeder`.

```rust
pub struct FeederAddedEvent {
    pub feeder: Address,
}
```

```json
{
  "feeder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/oracle_manager/src/lib.rs).

#### `mgr, fdr_rem`

Emitted by `remove_feeder`.

```rust
pub struct FeederRemovedEvent {
    pub feeder: Address,
}
```

```json
{
  "feeder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/oracle_manager/src/lib.rs).

#### `mgr, fdr_sub`

Emitted by `submit_price`.

```rust
pub struct FeederPriceSubmittedEvent {
    pub feeder: Address,
    pub price: i128,
    pub timestamp: u64,
}
```

```json
{
  "feeder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "price": "25000000",
  "timestamp": "1767225600"
}
```

Sources [lib.rs](../smart-contracts/contracts/oracle_manager/src/lib.rs).

#### `mgr, resolved`

Emitted by `resolve_price`. A usable price comes from the configured oracle, fresh authorized feeder submissions, or the fallback, in that order.

```rust
pub struct PriceResolvedEvent {
    pub pair: Symbol,
    pub price: i128,
    pub source: PriceSource,
}
```

```json
{
  "pair": "XLM_USD",
  "price": "25000000",
  "source": 0
}
```

Sources [lib.rs](../smart-contracts/contracts/oracle_manager/src/lib.rs).

### `payment_escrow`

#### `escrow, locked`

Emitted by `lock_funds`. The funds have been locked for the node.

Rust value type

```rust
(Symbol, Symbol, i128)
```

```json
[
  "example",
  "example",
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/payment_escrow/src/lib.rs).

#### `escrow, released`

Emitted by `release_funds`. The agent payout has been released. The amount is net of any platform fee.

Rust value type

```rust
(Symbol, Symbol, i128)
```

```json
[
  "example",
  "example",
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/payment_escrow/src/lib.rs).

#### `escrow, refunded`

Emitted by `refund_funds`. The escrow amount has been refunded.

Rust value type

```rust
(Symbol, Symbol, i128)
```

```json
[
  "example",
  "example",
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/payment_escrow/src/lib.rs).

#### `platform_fee_collected`

Emitted by `release_funds`. A nonzero platform fee is transferred during settlement.

```rust
pub struct PlatformFeeCollectedEvent {
    pub task_id: Symbol,
    pub agent_id: Address,
    pub fee_amount: i128,
    pub treasury_address: Address,
    pub ledger: u32,
}
```

```json
{
  "task_id": "task_42",
  "agent_id": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "fee_amount": "25000000",
  "treasury_address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/payment_escrow/src/lib.rs).

### `platform_config`

#### `plt_cfg, cfg_upd`

Emitted by `update_config`.

```rust
pub struct ConfigUpdatedEvent {
    pub updated_by: Address,
    pub new_config: PlatformConfig,
}
```

```json
{
  "updated_by": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "new_config": {
    "min_stake_per_capability": "25000000",
    "escrow_timeout_days": 3,
    "max_capabilities_per_agent": 3,
    "platform_fee_bps": 3
  }
}
```

Sources [lib.rs](../smart-contracts/contracts/platform_config/src/lib.rs).

#### `plt_cfg, fee_prop`

Emitted by `propose_fee_change`.

Rust value type

```rust
(Address, u32, u64)
```

```json
[
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  3,
  "42"
]
```

Sources [lib.rs](../smart-contracts/contracts/platform_config/src/lib.rs).

#### `plt_cfg, fee_app`

Emitted by `apply_fee_change`.

Rust value type

```rust
(Address, u32)
```

```json
[
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  3
]
```

Sources [lib.rs](../smart-contracts/contracts/platform_config/src/lib.rs).

### `price_oracle`

#### `oracle, rejected`

Emitted by `submit_feeder_price`. The submitted price exceeds the permitted deviation. The function publishes the diagnostic before returning an error.

```rust
pub struct PriceDeviationRejectedEvent {
    pub version: u32,
    pub feeder: Address,
    pub submitted_price: i128,
    pub median: i128,
    pub deviation_pct: u32,
    pub ledger: u32,
}
```

```json
{
  "version": 1,
  "feeder": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "submitted_price": "25000000",
  "median": "42",
  "deviation_pct": 3,
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/price_oracle/src/lib.rs).

#### `oracle, updated`

Emitted by `submit_feeder_price`.

```rust
pub struct PriceUpdatedEvent {
    pub version: u32,
    pub asset: Symbol,
    pub price: i128,
    pub median: i128,
    pub num_feeders: u32,
    pub ledger: u32,
}
```

```json
{
  "version": 1,
  "asset": "example",
  "price": "25000000",
  "median": "42",
  "num_feeders": 3,
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/price_oracle/src/lib.rs).

#### `oracle, age_set`

Emitted by `set_max_price_age`.

```rust
pub struct MaxAgeUpdatedEvent {
    pub version: u32,
    pub old_max_age: u64,
    pub new_max_age: u64,
    pub ledger: u32,
}
```

```json
{
  "version": 1,
  "old_max_age": "42",
  "new_max_age": "42",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/price_oracle/src/lib.rs).

### `reputation`

#### `reputat, outcome`

Emitted by `record_outcome`.

```rust
pub struct OutcomeRecordedEvent {
    pub agent_id: Symbol,
    pub task_id: Symbol,
    pub success: bool,
    pub rating: u32,
    pub new_score: i64,
}
```

```json
{
  "agent_id": "example",
  "task_id": "task_42",
  "success": true,
  "rating": 3,
  "new_score": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/reputation/src/lib.rs).

#### `reputat, decayed`

Emitted by `decay_reputation`.

```rust
pub struct ReputationDecayedEvent {
    pub agent_id: Symbol,
    pub old_score: i64,
    pub new_score: i64,
    pub weeks_elapsed: u64,
}
```

```json
{
  "agent_id": "example",
  "old_score": "42",
  "new_score": "42",
  "weeks_elapsed": "42"
}
```

Sources [lib.rs](../smart-contracts/contracts/reputation/src/lib.rs).

### `task_store`

#### `task_str, upgraded`

Emitted by `upgrade`.

```rust
pub struct ContractUpgradedEvent {
    pub version: u32,
    pub old_version: String,
    pub new_version: String,
    pub new_wasm_hash: BytesN<32>,
    pub admin: Address,
    pub ledger_sequence: u32,
}
```

```json
{
  "version": 1,
  "old_version": "1.1.0",
  "new_version": "1.1.0",
  "new_wasm_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "ledger_sequence": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

#### `task_str, coord_set`

Emitted by `set_coordinator`, `rotate_coordinator`.

```rust
pub struct CoordinatorSetEvent {
    pub version: u32,
    pub coordinator: Address,
}
```

```json
{
  "version": 1,
  "coordinator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

#### `task_meta, updated`

Emitted by `assign_task`, `assign_task_weighted`, `update_task_status`. A successful nonterminal lifecycle transition or a coordinator assignment.

```rust
pub struct TaskUpdatedEvent {
    pub version: u32,
    pub task_id: BytesN<32>,
    pub agent: Address,
    pub old_status: TaskStatus,
    pub new_status: TaskStatus,
    pub updated_at: u64,
}
```

```json
{
  "version": 1,
  "task_id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "agent": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "old_status": 0,
  "new_status": 0,
  "updated_at": "1767225600"
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

#### `task_meta, task_assigned`

Emitted by `assign_task_weighted`.

```rust
pub struct TaskAssignedEvent {
    pub version: u32,
    pub task_id: BytesN<32>,
    pub agent: Address,
    pub weight: u32,
    pub seed: u32,
    pub ledger: u32,
}
```

```json
{
  "version": 1,
  "task_id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "agent": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "weight": 3,
  "seed": 3,
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

#### `task_meta, finalized`

Emitted by `release_funds`, `fail_task`, `update_task_status`. An agent reaches a terminal state, the coordinator fails a task, or the coordinator acknowledges release for an already completed task.

```rust
pub struct TaskFinalizedEvent {
    pub version: u32,
    pub task_id: BytesN<32>,
    pub agent: Address,
    pub old_status: TaskStatus,
    pub final_status: TaskStatus,
    pub finalized_at: u64,
}
```

```json
{
  "version": 1,
  "task_id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "agent": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "old_status": 0,
  "final_status": 0,
  "finalized_at": "1767225600"
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

#### `task_str, ora_set`

Emitted by `set_oracle_manager`.

```rust
pub struct OracleManagerSetEvent {
    pub version: u32,
    pub oracle_manager: Option<Address>,
}
```

```json
{
  "version": 1,
  "oracle_manager": null
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

#### `task_meta, created`

Emitted by `store_task_metadata`.

```rust
pub struct TaskCreatedEvent {
    pub version: u32,
    pub task_id: BytesN<32>,
    pub prompt_hash: BytesN<32>,
    pub assigned_agents: Vec<Address>,
    pub created_at: u64,
    pub expires_at: u64,
    pub quoted_price_stroops: Option<i128>,
}
```

```json
{
  "version": 1,
  "task_id": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "prompt_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "assigned_agents": [
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
  ],
  "created_at": "1767225600",
  "expires_at": "1767225600",
  "quoted_price_stroops": null
}
```

Sources [lib.rs](../smart-contracts/contracts/task_store/src/lib.rs).

### `upgrade-manager`

#### `upgrade, init`

Emitted by `initialize`.

```rust
pub struct UpgradeInitializedEvent {
    pub admin: Address,
    pub version: String,
    pub wasm_hash: BytesN<32>,
}
```

```json
{
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "version": "1.1.0",
  "wasm_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `upgrade, adm_chng`

Emitted by `set_admin`.

```rust
pub struct AdminChangedEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}
```

```json
{
  "old_admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "new_admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `upgrade, proposed`

Emitted by `propose_upgrade`.

```rust
pub struct UpgradeProposedEvent {
    pub version: String,
    pub wasm_hash: BytesN<32>,
    pub proposer: Address,
    pub description: String,
}
```

```json
{
  "version": "1.1.0",
  "wasm_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "proposer": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "description": "Example event"
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `upgrade, validated`

Emitted by `validate_proposal`.

```rust
pub struct UpgradeValidatedEvent {
    pub version: String,
    pub estimated_gas: u64,
    pub validation_results: Vec<String>,
}
```

```json
{
  "version": "1.1.0",
  "estimated_gas": "42",
  "validation_results": [
    "Example event"
  ]
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `upgrade, applied`

Emitted by `execute_upgrade`.

```rust
pub struct UpgradeAppliedEvent {
    pub old_version: String,
    pub new_version: String,
    pub wasm_hash: BytesN<32>,
    pub admin: Address,
}
```

```json
{
  "old_version": "1.1.0",
  "new_version": "1.1.0",
  "wasm_hash": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `upgrade, rollback`

Emitted by `execute_rollback`.

```rust
pub struct UpgradeRolledBackEvent {
    pub reverted_version: String,
    pub restored_version: String,
    pub admin: Address,
}
```

```json
{
  "reverted_version": "1.1.0",
  "restored_version": "1.1.0",
  "admin": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `rollback_executed`

Emitted by `execute_rollback`.

```rust
pub struct RollbackExecutedEvent {
    pub contract_id: Address,
    pub from_version: String,
    pub to_version: String,
    pub ledger: u32,
}
```

```json
{
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "from_version": "1.1.0",
  "to_version": "1.1.0",
  "ledger": 3
}
```

Sources [lib.rs](../smart-contracts/contracts/upgrade-manager/src/lib.rs).

#### `upgrade, progress`

Emitted by `execute_post_upgrade_migration`. A post-upgrade migration advanced its cursor and has more work.

```rust
pub struct MigrationProgressEvent {
    pub phase: String,
    pub items_processed: u32,
    pub total_items: u32,
    pub gas_used: u64,
}
```

```json
{
  "phase": "Example event",
  "items_processed": 3,
  "total_items": 3,
  "gas_used": "42"
}
```

Sources [migration.rs](../smart-contracts/contracts/upgrade-manager/src/migration.rs).

#### `upgrade, complete`

Emitted by `execute_post_upgrade_migration`. A post-upgrade migration reached its final batch.

```rust
pub struct MigrationCompleteEvent {
    pub version: String,
    pub items_migrated: u32,
    pub total_gas_used: u64,
    pub success: bool,
}
```

```json
{
  "version": "1.1.0",
  "items_migrated": 3,
  "total_gas_used": "42",
  "success": true
}
```

Sources [migration.rs](../smart-contracts/contracts/upgrade-manager/src/migration.rs).

## Off-chain events

Connect to `/tasks/<taskId>/stream` on the backend WebSocket host. Send `{"walletPublicKey":"<task owner public key>"}` as the first message within ten seconds. The current handler checks the supplied address against the stored owner address. Reply to each `{"type":"ping"}` control frame with `{"type":"pong"}`.

The server sends the task's stored events in per-task sequence order, followed by live updates. Each WebSocket message contains a complete JSON object. **Field order is unspecified** for all events. Parse by key and dispatch on `type`. The `?events=` parameter has no filtering behavior in the current route. Subscribe by task and filter types after parsing.

Delivery is **at-least-once for persisted events that remain in the stream store**, with replay on reconnect. Save `seq` after successful processing and reconnect with `?lastEventId=<seq>` to receive strictly larger sequences. Deduplicate by `(taskId, seq)`. A connection without a cursor replays from the start of retained history. Persist cursor progress for events skipped by a client-side filter too.

The following interfaces describe the wire envelope and the current coordinator's payloads. Stored-event producers can use the additional typed payload fields shown below. See [stream normalization](../backend/src/api/routes/stream.ts), [the coordinator](../backend/src/coordinator/coordinator.ts), and [stored event types](../backend/src/events/eventTypes.ts).

```ts
interface TaskStreamEvent {
  taskId: string;
  seq: number;
  timestamp: string;
  traceId: string;
}

interface NodeStarted extends TaskStreamEvent {
  type: "node_started";
  nodeId: string;
  payload: { agentType?: string; timeoutMs?: number };
}

interface NodeCompleted extends TaskStreamEvent {
  type: "node_completed";
  nodeId: string;
  payload: unknown;
}

interface NodeFailed extends TaskStreamEvent {
  type: "node_failed";
  nodeId: string;
  payload: { error: string; retryCount?: number };
}

interface PaymentLocked extends TaskStreamEvent {
  type: "payment_locked";
  nodeId: string;
  payload: { balanceId: string; amountStroops: number; xlmAmount?: number };
}

interface PaymentReleased extends TaskStreamEvent {
  type: "payment_released";
  nodeId: string;
  payload: { txHash: string; ledgerSequence?: number };
}

interface TaskCompleted extends TaskStreamEvent {
  type: "task_completed";
  payload?: { durationMs?: number };
}

interface TaskFailed extends TaskStreamEvent {
  type: "task_failed";
  payload?: { error?: string; failedStage?: string };
}
```

| Event | Emission | Delivery |
| --- | --- | --- |
| `node_started` | A DAG node enters running state, before dispatch. The coordinator sends an empty payload. | At-least-once with replay |
| `node_completed` | Dispatch finishes successfully and the node result is recorded. The payload is the agent's result directly. | At-least-once with replay |
| `node_failed` | Dispatch or node settlement fails, or a dependency failure prevents the node from running. | At-least-once with replay |
| `payment_locked` | Represents payment reservation for a node. The event store and wire adapter support this type, but the current coordinator has no live publisher for it. | At-least-once for records written to the store |
| `payment_released` | The coordinator's payment service returns a Stellar release transaction hash. | At-least-once with replay |
| `task_completed` | All DAG nodes completed successfully. | At-least-once with replay |
| `task_failed` | The DAG settles with one or more failed nodes. | At-least-once with replay |

These are independent examples. A live producer can also persist other event types, such as the stored schema's `TaskCreated`, which the generic wire adapter would serialize as `task_created`. Ignore unfamiliar types unless your application needs them.

### `node_started`

```json
{
  "type": "node_started",
  "taskId": "task_ab12cd34ef56",
  "seq": 0,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35",
  "nodeId": "search_1",
  "payload": {}
}
```

### `node_completed`

```json
{
  "type": "node_completed",
  "taskId": "task_ab12cd34ef56",
  "seq": 1,
  "timestamp": "2026-01-01T00:00:01.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35",
  "nodeId": "search_1",
  "payload": {
    "summary": "Three matching sources found"
  }
}
```

### `node_failed`

```json
{
  "type": "node_failed",
  "taskId": "task_ab12cd34ef56",
  "seq": 2,
  "timestamp": "2026-01-01T00:00:02.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35",
  "nodeId": "search_1",
  "payload": {
    "error": "Dependency search_0 failed"
  }
}
```

### `payment_locked`

```json
{
  "type": "payment_locked",
  "taskId": "task_ab12cd34ef56",
  "seq": 3,
  "timestamp": "2026-01-01T00:00:03.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35",
  "nodeId": "search_1",
  "payload": {
    "balanceId": "000000001b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b",
    "amountStroops": 25000000,
    "xlmAmount": 2.5
  }
}
```

### `payment_released`

```json
{
  "type": "payment_released",
  "taskId": "task_ab12cd34ef56",
  "seq": 4,
  "timestamp": "2026-01-01T00:00:04.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35",
  "nodeId": "search_1",
  "payload": {
    "txHash": "4ad54ad54ad54ad54ad54ad54ad54ad54ad54ad54ad54ad54ad54ad54ad54ad5"
  }
}
```

### `task_completed`

```json
{
  "type": "task_completed",
  "taskId": "task_ab12cd34ef56",
  "seq": 5,
  "timestamp": "2026-01-01T00:00:05.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35"
}
```

### `task_failed`

```json
{
  "type": "task_failed",
  "taskId": "task_ab12cd34ef56",
  "seq": 6,
  "timestamp": "2026-01-01T00:00:06.000Z",
  "traceId": "2c2ac8de-9608-41b2-b40d-a3d45f9eaa35"
}
```

## Schema versioning

For a versioned contract payload, read its numeric `version` field and dispatch by contract, topics, and version. Older unversioned payloads must be interpreted using the deployed contract's ABI and release history. RPC envelope fields and a contract's deployment version do not serve as event schema versions.

The backend stores a numeric `version` per event and keeps version-specific validators in its [schema registry](../backend/src/events/schemaRegistry.ts). The current WebSocket serializer drops that stored version, so clients cannot detect it from a WebSocket frame. Consumers that need the version can inspect the underlying stored event through the backend's versioned event interfaces.

New optional fields are backward compatible. Read known properties and tolerate unknown ones. Removing or renaming a field, making an optional field required, changing a field's type or units, or changing a topic's meaning is breaking. Announce breaking changes with a deprecation period and a migration path before retiring the old schema. Versioned producers should publish a new schema revision for breaking changes and keep readers for retained historical versions. Adding an optional field does not by itself require a version bump. The stored backend schema already uses a v2 revision documenting an additive set of fields.

## Combined JavaScript example

Run this browser example in a bundled module with `@stellar/stellar-sdk`. Supply the task owner address, a recent ledger within RPC retention, the deployment's contract IDs, and the WebSocket origin. The RPC poller matches the Soroban release event. Horizon SSE supplies transaction observations for a known account, including claimable-balance releases used by the current backend payment service. The WebSocket reports application progress and the release transaction hash.

Join matching transaction observations by network and hash. Where the deployment uses the Soroban escrow, correlate its task and node symbols with application IDs using the deployment's ID mapping. The coordinator's claimable-balance path can produce a WebSocket release and a Horizon transaction without a Soroban escrow event. Treat the channels as independent, with their own cursors and no global ordering.

```js
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

const rpcUrl = "https://soroban-testnet.stellar.org";
const horizonUrl = "https://horizon-testnet.stellar.org";
const wsOrigin = "ws://localhost:3001";
const taskId = "task_ab12cd34ef56";
const wallet = "<task owner public key>";
const paymentAccount = "<coordinator account to observe on Horizon>";
const escrowId = "<payment escrow contract ID>";
const disputeId = "<dispute resolution contract ID>";
const taskStoreId = "<task store contract ID>";
const startLedger = Number("<recent ledger sequence>");

function topicFilter(contractId, ...symbols) {
  return {
    type: "contract",
    contractIds: [contractId],
    topics: [symbols.map(symbol =>
      nativeToScVal(symbol, { type: "symbol" }).toXDR("base64")
    )],
  };
}

const released = topicFilter(escrowId, "escrow", "released");
// Other exact topic-filter queries using the same getEvents helper.
const disputeRaised = topicFilter(disputeId, "dispute", "raised");
const taskCreated = topicFilter(taskStoreId, "task_meta", "created");

async function getEvents(filters, cursor) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getEvents",
      params: {
        ...(cursor ? {} : { startLedger }),
        filters,
        pagination: { limit: 100, ...(cursor ? { cursor } : {}) },
      },
    }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const { result, error } = await response.json();
  if (error) throw new Error(error.message);
  return result;
}

const rpcKey = `testnet:escrow:${escrowId}:released`;
async function pollEscrow() {
  try {
    const cursor = localStorage.getItem(rpcKey);
    const page = await getEvents([released], cursor);
    for (const event of page.events) {
      const [task, node, amount] = scValToNative(xdr.ScVal.fromXDR(event.value, "base64"));
      console.log("Soroban release", event.id, event.txHash, task, node, String(amount));
    }
    if (page.cursor) localStorage.setItem(rpcKey, page.cursor);
  } catch (error) {
    console.error(error);
  } finally {
    setTimeout(pollEscrow, 5000);
  }
}

// For related filters use getEvents([disputeRaised, taskCreated], cursor)
// with a separate stored cursor for that filter set.
void pollEscrow();

const horizonKey = `testnet:horizon:${paymentAccount}`;
const horizonCursor = localStorage.getItem(horizonKey) ?? "now";
const sse = new EventSource(
  `${horizonUrl}/accounts/${encodeURIComponent(paymentAccount)}/transactions?cursor=${encodeURIComponent(horizonCursor)}`
);
sse.onmessage = ({ data }) => {
  const transaction = JSON.parse(data);
  console.log("Horizon transaction", transaction.hash);
  localStorage.setItem(horizonKey, transaction.paging_token);
};

function connectTask() {
  const key = `${wsOrigin}:task:${taskId}`;
  const url = new URL(`/tasks/${encodeURIComponent(taskId)}/stream`, wsOrigin);
  const seq = localStorage.getItem(key);
  if (seq !== null) url.searchParams.set("lastEventId", seq);

  const ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ walletPublicKey: wallet }));
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    console.log("Task event", event);
    if (event.type === "payment_released") {
      console.log("Coordinator release", event.payload.txHash);
    }
    localStorage.setItem(key, String(event.seq));
  };
  ws.onclose = ({ code }) => {
    if (code !== 4003 && code !== 4004) setTimeout(connectTask, 3000);
  };
}
connectTask();
```
