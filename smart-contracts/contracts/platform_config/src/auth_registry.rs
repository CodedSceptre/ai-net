//! Instance-scoped contract addresses and cross-contract permissions.

use crate::{DataKey, Error, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::{contracttype, symbol_short, Address, Env, String};

const MAX_CONTRACTS: u32 = 32;
const MAX_PERMISSIONS: u32 = 64;
const MAX_NAME_LENGTH: u32 = 32;

#[contracttype]
#[derive(Clone)]
enum Key {
    Contract(String),
    References(Address),
    Permission(Address, Address, String),
    ContractCount,
    PermissionCount,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractRegistered {
    pub name: String,
    pub address: Address,
}

pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    if &admin != caller {
        return Err(Error::Unauthorized);
    }
    caller.require_auth();
    Ok(())
}

pub fn register(env: &Env, name: String, address: Address) -> Result<(), Error> {
    validate_name(&name)?;
    let store = env.storage().instance();
    let count: u32 = store.get(&Key::ContractCount).unwrap_or(0);
    let key = Key::Contract(name.clone());
    if let Some(old_address) = store.get::<_, Address>(&key) {
        if old_address != address {
            ensure_unreferenced(env, &old_address)?;
        }
    } else {
        if count >= MAX_CONTRACTS {
            return Err(Error::RegistryFull);
        }
        store.set(&Key::ContractCount, &(count + 1));
    }
    store.set(&key, &address);
    store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    env.events().publish(
        (symbol_short!("auth_reg"), symbol_short!("register")),
        ContractRegistered { name, address },
    );
    Ok(())
}

pub fn get(env: &Env, name: String) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&Key::Contract(name))
        .ok_or(Error::ContractNotFound)
}

pub fn deregister(env: &Env, name: String) -> Result<(), Error> {
    let address = get(env, name.clone())?;
    ensure_unreferenced(env, &address)?;
    let store = env.storage().instance();
    let count: u32 = store.get(&Key::ContractCount).unwrap_or(0);
    store.remove(&Key::Contract(name));
    store.set(&Key::ContractCount, &(count - 1));
    store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    Ok(())
}

pub fn set_permission(
    env: &Env,
    caller: Address,
    target: Address,
    function: String,
    allowed: bool,
) -> Result<(), Error> {
    validate_name(&function)?;
    let store = env.storage().instance();
    let key = Key::Permission(caller.clone(), target.clone(), function.clone());
    if store.has(&key) == allowed {
        return Ok(());
    }

    let count: u32 = store.get(&Key::PermissionCount).unwrap_or(0);
    if allowed {
        if count >= MAX_PERMISSIONS {
            return Err(Error::RegistryFull);
        }
        store.set(&key, &true);
        store.set(&Key::PermissionCount, &(count + 1));
    } else {
        store.remove(&key);
        store.set(&Key::PermissionCount, &(count - 1));
    }
    update_references(env, &caller, allowed);
    if caller != target {
        update_references(env, &target, allowed);
    }
    store.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    env.events().publish(
        (symbol_short!("auth_reg"), symbol_short!("perm")),
        (caller, target, function, allowed),
    );
    Ok(())
}

pub fn is_authorized(env: &Env, caller: Address, target: Address, function: String) -> bool {
    env.storage()
        .instance()
        .get(&Key::Permission(caller, target, function))
        .unwrap_or(false)
}

fn validate_name(name: &String) -> Result<(), Error> {
    if name.is_empty() || name.len() > MAX_NAME_LENGTH {
        return Err(Error::InvalidRegistryName);
    }
    Ok(())
}

fn ensure_unreferenced(env: &Env, address: &Address) -> Result<(), Error> {
    if env
        .storage()
        .instance()
        .has(&Key::References(address.clone()))
    {
        return Err(Error::ContractHasActiveAuthorizations);
    }
    Ok(())
}

fn update_references(env: &Env, address: &Address, increment: bool) {
    let store = env.storage().instance();
    let key = Key::References(address.clone());
    let count: u32 = store.get(&key).unwrap_or(0);
    if increment {
        store.set(&key, &(count + 1));
    } else if count == 1 {
        store.remove(&key);
    } else {
        store.set(&key, &(count - 1));
    }
}

#[cfg(test)]
mod tests {
    use crate::{Error, PlatformConfigContract, PlatformConfigContractClient};
    use payment_escrow::{
        Error as EscrowError, PaymentEscrowContract, PaymentEscrowContractClient,
    };
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events},
        Address, Env, IntoVal, String, TryFromVal,
    };

    #[test]
    fn permissions_are_scoped_and_block_deregistration_until_revoked() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(PlatformConfigContract, ());
        let client = PlatformConfigContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        let name = String::from_str(&env, "task_store");
        let function = String::from_str(&env, "record_outcome");
        client.initialize(&admin);
        assert_eq!(
            client.try_get_contract(&name),
            Err(Ok(Error::ContractNotFound))
        );
        assert_eq!(
            client.try_register_contract(&target, &name, &caller),
            Err(Ok(Error::Unauthorized))
        );
        client.register_contract(&admin, &name, &caller);
        assert_eq!(client.get_contract(&name), caller);
        let event = env.events().all().last().unwrap();
        assert_eq!(
            event.1,
            (symbol_short!("auth_reg"), symbol_short!("register")).into_val(&env)
        );
        assert_eq!(
            super::ContractRegistered::try_from_val(&env, &event.2).unwrap(),
            super::ContractRegistered {
                name: name.clone(),
                address: caller.clone()
            }
        );
        assert!(!client.is_authorized(&caller, &target, &function));
        client.authorize_caller(&admin, &caller, &target, &function);
        assert!(client.is_authorized(&caller, &target, &function));
        assert!(!client.is_authorized(&target, &caller, &function));
        assert_eq!(
            client.try_deregister_contract(&admin, &name),
            Err(Ok(Error::ContractHasActiveAuthorizations))
        );
        client.revoke_caller(&admin, &caller, &target, &function);
        assert!(!client.is_authorized(&caller, &target, &function));
        client.deregister_contract(&admin, &name);
        assert_eq!(
            client.try_get_contract(&name),
            Err(Ok(Error::ContractNotFound))
        );
    }

    #[test]
    fn escrow_rejects_unlisted_cross_contract_permissions() {
        let env = Env::default();
        env.mock_all_auths();
        let registry_id = env.register(PlatformConfigContract, ());
        let escrow_id = env.register(PaymentEscrowContract, ());
        let registry = PlatformConfigContractClient::new(&env, &registry_id);
        let escrow = PaymentEscrowContractClient::new(&env, &escrow_id);
        let admin = Address::generate(&env);
        let coordinator = Address::generate(&env);
        let submitter = Address::generate(&env);
        let agent = Address::generate(&env);
        let task = symbol_short!("task");
        let node = symbol_short!("node");
        registry.initialize(&admin);
        escrow.initialize(&coordinator);
        escrow.lock_funds(&task, &node, &submitter, &agent, &100);
        escrow.set_auth_registry(&registry_id);

        assert_eq!(
            escrow.try_release_funds(&task, &node),
            Err(Ok(EscrowError::Unauthorized))
        );
        let release = String::from_str(&env, "release_funds");
        registry.authorize_caller(&admin, &coordinator, &escrow_id, &release);
        assert_eq!(
            escrow.release_funds(&task, &node).status,
            payment_escrow::EscrowStatus::Released
        );
    }
}
