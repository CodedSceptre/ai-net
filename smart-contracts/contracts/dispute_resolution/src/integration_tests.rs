use super::*;
use multisig_governance::{
    Error as GovernanceError, GovernanceAction, MultisigGovernanceContract,
    MultisigGovernanceContractClient, TIMELOCK_SECS,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    IntoVal, TryFromVal, Val,
};

struct Fixture {
    env: Env,
    client: DisputeResolutionContractClient<'static>,
    governance: MultisigGovernanceContractClient<'static>,
    signers: [Address; 3],
    submitter: Address,
    agent: Address,
    fee_recipient: Address,
    asset: Address,
    dispute_id: u64,
}

fn fixture(amount: i128) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let submitter = Address::generate(&env);
    let agent = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let signers = core::array::from_fn(|_| Address::generate(&env));
    let governance_address = env.register(MultisigGovernanceContract, ());
    let governance = MultisigGovernanceContractClient::new(&env, &governance_address);
    governance.initialize(&Vec::from_array(&env, signers.clone()), &1);

    let address = env.register(DisputeResolutionContract, ());
    let client = DisputeResolutionContractClient::new(&env, &address);
    client.initialize(&admin);
    let arbiters = Vec::from_array(
        &env,
        core::array::from_fn::<_, 5, _>(|_| Address::generate(&env)),
    );
    client.set_arbiters(&arbiters);
    let asset = env.register_stellar_asset_contract_v2(admin).address();
    client.configure_escalation(&governance_address, &asset, &fee_recipient);
    token::StellarAssetClient::new(&env, &asset).mint(&submitter, &amount);
    let task = symbol_short!("task");
    client.fund_task_escrow(&submitter, &task, &agent, &asset, &amount, &0);
    let dispute_id = client.raise_dispute(
        &submitter,
        &task,
        &BytesN::from_array(&env, &[1; 32]),
        &String::from_str(&env, "conflicting delivery evidence"),
    );
    for index in 0..3 {
        client.vote_on_dispute(&arbiters.get(index).unwrap(), &dispute_id, &Vote::Approve);
    }

    Fixture {
        env,
        client,
        governance,
        signers,
        submitter,
        agent,
        fee_recipient,
        asset,
        dispute_id,
    }
}

#[test]
fn either_participant_can_contest_a_provisional_outcome() {
    let amount = 20 * 10_000_000;
    for agent_escalates in [false, true] {
        let f = fixture(amount);
        let id = f.dispute_id;
        let reason = EscalationReason::EvidenceConflict;
        let participant = if agent_escalates {
            &f.agent
        } else {
            &f.submitter
        };
        assert_eq!(
            f.client.try_escalate_dispute(&id, participant, &reason),
            Err(Ok(Error::EscalationUnavailable))
        );

        f.env.ledger().set_timestamp(VOTING_PERIOD_SECS);
        assert_eq!(
            f.client.attempt_resolution(&id, participant),
            Resolution::Approve
        );
        assert_eq!(
            f.client.try_resolve_dispute(&id),
            Err(Ok(Error::ContestWindowActive))
        );
        let stranger = Address::generate(&f.env);
        assert_eq!(
            f.client.try_escalate_dispute(&id, &stranger, &reason),
            Err(Ok(Error::Unauthorized))
        );

        f.client.escalate_dispute(&id, participant, &reason);
        let (_, topics, body) = f.env.events().all().last().unwrap();
        let expected: Vec<Val> = (
            symbol_short!("dispute"),
            Symbol::new(&f.env, "DisputeEscalated"),
        )
            .into_val(&f.env);
        assert_eq!(topics, expected);
        let event = DisputeEscalatedEvent::try_from_val(&f.env, &body).unwrap();
        assert_eq!(event.dispute_id, id);
        assert_eq!(event.reason, reason);
        assert_eq!(event.escalated_at, VOTING_PERIOD_SECS);

        let token = token::Client::new(&f.env, &f.asset);
        assert_eq!(token.balance(&f.fee_recipient), ESCALATION_FEE);
        assert_eq!(token.balance(&f.client.address), amount - ESCALATION_FEE);
        assert_eq!(
            f.client.try_resolve_dispute(&id),
            Err(Ok(Error::EscalationRequired))
        );
        assert_eq!(
            f.client.get_escalation_sla_status(&id),
            EscalationSlaStatus::Remaining(ESCALATION_SLA_SECS)
        );
    }
}

#[test]
fn high_value_escalation_requires_a_governance_majority_and_can_resolve_overdue() {
    let amount = ESCALATION_THRESHOLD + 1;
    let f = fixture(amount);
    let id = f.dispute_id;
    f.client
        .escalate_dispute(&id, &f.agent, &EscalationReason::SystemError);
    assert_eq!(
        f.client.get_escalation(&id).unwrap().reason,
        EscalationReason::AmountExceedsThreshold
    );

    let decision = DisputeDecision::Approve;
    assert_eq!(
        f.client.try_resolve_escalated(&id, &f.agent, &decision),
        Err(Ok(Error::Unauthorized))
    );

    let proposer = &f.signers[0];
    let proposal = f.governance.propose(
        proposer,
        &String::from_str(&f.env, "Resolve dispute"),
        &String::from_str(&f.env, "Release the escrow remainder"),
        &GovernanceAction::ResolveDispute(f.client.address.clone(), id, decision as u32),
    );
    f.env.ledger().set_timestamp(TIMELOCK_SECS);
    assert_eq!(
        f.governance.try_execute(proposer, &proposal),
        Err(Ok(GovernanceError::InsufficientApprovals))
    );
    f.governance.approve(&f.signers[1], &proposal);

    let now = ESCALATION_SLA_SECS + 1;
    f.env.ledger().set_timestamp(now);
    assert_eq!(
        f.client.get_escalation_sla_status(&id),
        EscalationSlaStatus::Overdue(1)
    );
    f.governance.execute(proposer, &proposal);
    assert_eq!(
        f.client.get_dispute(&id).unwrap().resolution,
        Some(decision as u32)
    );
    assert_eq!(
        f.client.get_escalation_sla_status(&id),
        EscalationSlaStatus::Resolved(now)
    );
    let token = token::Client::new(&f.env, &f.asset);
    assert_eq!(token.balance(&f.agent), amount - ESCALATION_FEE);
    assert_eq!(token.balance(&f.client.address), 0);
}
