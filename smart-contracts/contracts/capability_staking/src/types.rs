use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationRecord {
    pub delegator: Address,
    pub amount: i128,
    pub delegated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PendingUndelegation {
    pub delegator: Address,
    pub amount: i128,
    pub claimable_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeDelegated {
    pub delegator: Address,
    pub delegatee: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UndelegationInitiated {
    pub delegator: Address,
    pub delegatee: Address,
    pub amount: i128,
    pub claimable_at: u64,
}
