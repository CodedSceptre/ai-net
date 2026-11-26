//! # Reputation Contract Error Codes
//!
//! Every variant maps to a stable `u32` status code so off-chain callers can
//! branch on the numeric code without coupling to a specific SDK build.
//!
//! **Never renumber an existing variant** once the contract is deployed.

use soroban_sdk::contracterror;

/// Errors surfaced by the `reputation` contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract has not been initialized.
    NotInitialized = 1,
    /// Contract has already been initialized.
    AlreadyInitialized = 2,
    /// The caller is not authorized to record outcomes.
    Unauthorized = 3,
    /// The rating value is out of range [0, 5].
    InvalidRating = 4,
    /// The agent has not been seen before (no reputation entry).
    AgentNotFound = 5,
    /// The authorized caller address is already registered.
    CallerAlreadyRegistered = 6,
    /// The authorized caller address was not found.
    CallerNotFound = 7,
    /// `initialize` has already been called.
    AlreadyInitialized = 1,
    /// The contract must be initialised before this operation.
    NotInitialized = 2,
    /// The caller is not the admin.
    Unauthorized = 3,
    /// No vesting schedule found for this agent.
    VestingNotFound = 4,
    /// The vesting period has not yet started (current time < start_timestamp).
    VestingNotStarted = 5,
    /// A vesting schedule already exists for this agent and is still active.
    VestingAlreadyExists = 6,
    /// The total_amount must be greater than zero.
    InvalidAmount = 7,
    /// The duration must be greater than zero.
    InvalidDuration = 8,
}
