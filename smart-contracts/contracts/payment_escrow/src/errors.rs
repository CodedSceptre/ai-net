//! Error codes for the payment escrow contract.
//! # Error Types for Payment Escrow

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract already initialized.
    AlreadyInitialized = 1,
    /// Caller is not authorized for this operation.
    Unauthorized = 2,
    /// Escrow record not found for the given task_id.
    NotFound = 3,
    /// An escrow with this task_id already exists.
    AlreadyExists = 4,
    /// Amount must be positive.
    InvalidAmount = 5,
    /// timeout_ledger must be in the future.
    InvalidTimeout = 6,
    /// Escrow has already been released.
    AlreadyReleased = 7,
    /// Escrow is in Disputed state; use dispute_resolution contract.
    EscrowDisputed = 8,
    /// Escrow has already expired.
    AlreadyExpired = 9,
    /// Escrow is in Expired state; funds have been returned.
    EscrowExpired = 10,
    /// timeout_ledger has not been reached yet.
    NotYetExpired = 11,
    /// Escrow is already in Disputed state.
    AlreadyDisputed = 12,
    /// Contract has not been initialized.
    NotInitialized = 1,
    /// Caller is not authorized to perform this action.
    Unauthorized = 2,
    /// The contract has already been initialized.
    AlreadyInitialized = 3,
    /// The contract is currently paused; new locks are rejected.
    ContractPaused = 4,
    /// The escrow record for this task does not exist.
    EscrowNotFound = 5,
    /// The escrow has already been released or refunded.
    EscrowAlreadySettled = 6,
    /// The lock amount must be greater than zero.
    InvalidAmount = 7,
}
