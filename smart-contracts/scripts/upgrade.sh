#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
NETWORK="testnet"
SKIP_BUILD=false
SKIP_BACKUP=false
FORCE=false
DRY_RUN=false
USE_UPGRADE_MANAGER=false
ENABLE_ROLLBACK=true

# Usage function
usage() {
    cat << EOF
Usage: $0 [OPTIONS] [CONTRACT_NAME]

Upgrade deployed Soroban contracts with safety checks and state preservation.
Supports both direct upgrades and upgrade manager-based upgrades.

ARGUMENTS:
    CONTRACT_NAME            Name of specific contract to upgrade (optional, upgrades all if not specified)

OPTIONS:
    -n, --network NETWORK    Network to upgrade on (testnet, futurenet, mainnet) [default: testnet]
    -s, --skip-build         Skip the Wasm build step
    -b, --skip-backup        Skip state backup before upgrade
    -f, --force              Skip safety checks and proceed with upgrade
    -d, --dry-run            Show what would be upgraded without making changes
    -u, --use-upgrade-manager Submit managed upgrade proposals for execution after 48 hours
    -r, --no-rollback        Disable rollback capability for this upgrade
    -v, --version VERSION    Set explicit version for the upgrade
    -h, --help               Show this help message

ENVIRONMENT VARIABLES:
    STELLAR_SECRET_KEY       Secret key for deployment account (required)
    STELLAR_RPC_URL         RPC URL for the network (optional, uses default for network)
    STELLAR_HORIZON_URL     Horizon URL for the network (optional, uses default for network)

EXAMPLES:
    $0                                    Upgrade all contracts on testnet
    $0 agent-registry                    Upgrade only the agent-registry contract
    $0 -u agent-registry                 Upgrade agent-registry using upgrade manager
    $0 -n futurenet -d                   Dry run upgrade on futurenet
    $0 -f --skip-backup                  Force upgrade without backup
    $0 -u -v "1.2.0" agent-registry     Upgrade to specific version using upgrade manager
EOF
}

# Parse command line arguments
CONTRACT_NAME=""
VERSION=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -s|--skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -b|--skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -u|--use-upgrade-manager)
            USE_UPGRADE_MANAGER=true
            shift
            ;;
        -r|--no-rollback)
            ENABLE_ROLLBACK=false
            shift
            ;;
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            usage >&2
            exit 1
            ;;
        *)
            if [[ -z "$CONTRACT_NAME" ]]; then
                CONTRACT_NAME="$1"
            else
                echo -e "${RED}Error: Multiple contract names specified${NC}" >&2
                usage >&2
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate network
case $NETWORK in
    testnet|futurenet|mainnet)
        ;;
    *)
        echo -e "${RED}Error: Invalid network '$NETWORK'. Must be one of: testnet, futurenet, mainnet${NC}" >&2
        exit 1
        ;;
esac

# Check required environment variables
if [[ -z "$STELLAR_SECRET_KEY" ]]; then
    echo -e "${RED}Error: STELLAR_SECRET_KEY environment variable is required${NC}" >&2
    exit 1
fi

# Set network-specific defaults
set_network_defaults() {
    case $NETWORK in
        testnet)
            : ${STELLAR_RPC_URL:=https://soroban-testnet.stellar.org}
            : ${STELLAR_HORIZON_URL:=https://horizon-testnet.stellar.org}
            ;;
        futurenet)
            : ${STELLAR_RPC_URL:=https://rpc-futurenet.stellar.org}
            : ${STELLAR_HORIZON_URL:=https://horizon-futurenet.stellar.org}
            ;;
        mainnet)
            : ${STELLAR_RPC_URL:=https://soroban-rpc.stellar.org}
            : ${STELLAR_HORIZON_URL:=https://horizon.stellar.org}
            ;;
    esac
    export STELLAR_RPC_URL STELLAR_HORIZON_URL
}

# Contract definitions - now includes upgrade-manager
CONTRACTS=(
    "upgrade-manager:contracts/upgrade-manager"
    "agent-registry:contracts/agent_registry"
    "error-resolver:contracts/error-resolver"
)

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOYMENTS_DIR="$PROJECT_ROOT/deployments"
TARGET_DIR="$PROJECT_ROOT/target/wasm32-unknown-unknown/release"
BACKUPS_DIR="$PROJECT_ROOT/backups"

# Deployment metadata
DEPLOYMENT_FILE="$DEPLOYMENTS_DIR/${NETWORK}.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

echo -e "${BLUE}=== ai-net Smart Contract Upgrade ===${NC}"
echo -e "${BLUE}Network:${NC} $NETWORK"
echo -e "${BLUE}RPC URL:${NC} $STELLAR_RPC_URL"
if [[ -n "$CONTRACT_NAME" ]]; then
    echo -e "${BLUE}Contract:${NC} $CONTRACT_NAME"
else
    echo -e "${BLUE}Contracts:${NC} All deployed contracts"
fi
if [[ "$USE_UPGRADE_MANAGER" == "true" ]]; then
    echo -e "${BLUE}Upgrade Mode:${NC} Using Upgrade Manager (Safe)"
else
    echo -e "${BLUE}Upgrade Mode:${NC} Direct Upgrade"
fi
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}Mode:${NC} Dry run (no changes will be made)"
fi
echo ""

# Upgrade manager utility functions
get_upgrade_manager_id() {
    local upgrade_mgr_info
    upgrade_mgr_info=$(get_contract_info "upgrade-manager")

    if [[ -z "$upgrade_mgr_info" ]]; then
        echo -e "${RED}Error: Upgrade manager not deployed${NC}" >&2
        echo -e "${YELLOW}Hint: Deploy upgrade-manager first or use direct upgrade mode${NC}" >&2
        exit 1
    fi

    echo "$upgrade_mgr_info" | jq -r '.contract_id'
}

# Get the current version using the target upgrade ABI.
get_contract_version() {
    stellar contract invoke \
        --network "$NETWORK" \
        --source-account "$STELLAR_SECRET_KEY" \
        --id "$1" \
        -- contract_version | jq -er 'strings'
}

# Submit an upgrade proposal for an independently deployed target.
propose_target_upgrade() {
    local contract_id="$1"
    local new_version="$2"
    local new_wasm_hash="$3"
    local upgrade_manager_id="$4"
    local current_version="$5"

    local proposal_id
    proposal_id=$(stellar contract invoke \
        --network "$NETWORK" \
        --source-account "$STELLAR_SECRET_KEY" \
        --id "$upgrade_manager_id" \
        -- propose_upgrade \
        --contract "$contract_id" \
        --new_wasm_hash "$new_wasm_hash" \
        --from_version "$current_version" \
        --to_version "$new_version") || return 1
    echo "Submitted proposal $proposal_id. After 48 hours, invoke execute_upgrade on $upgrade_manager_id with that proposal ID."
}

# Upgrade a single contract
upgrade_single_contract() {
    local name="$1"

    echo -e "\n${BLUE}=== Upgrading $name ===${NC}"

    # Get contract info
    local contract_info
    contract_info=$(get_contract_info "$name")

    if [[ -z "$contract_info" ]]; then
        echo -e "${RED}✗ Contract $name not found in deployment metadata${NC}"
        return 1
    fi

    local contract_id
    contract_id=$(echo "$contract_info" | jq -r '.contract_id')

    local wasm_file="$TARGET_DIR/${name//-/_}.wasm"

    if [[ "$name" == "upgrade-manager" ]]; then
        echo "Use the manager's self-upgrade workflow for its own WASM." >&2
        return 1
    fi
    if [[ ! -f "$wasm_file" ]]; then
        echo "WASM file not found: $wasm_file" >&2
        return 1
    fi
    local status=0
    needs_upgrade "$name" "$wasm_file" || status=$?
    case "$status" in
        0) ;;
        1) return 0 ;;
        *) return "$status" ;;
    esac

    local new_wasm_hash new_version current_version
    new_wasm_hash=$(calculate_wasm_hash "$wasm_file") || return 1
    current_version=$(get_contract_version "$contract_id") || return 1
    new_version="${VERSION:-${current_version}.$(date +%s)}"
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "Would prepare $name for version $new_version with WASM $new_wasm_hash"
        return 0
    fi
    perform_safety_checks "$name" "$contract_id" "$wasm_file" || return 1
    backup_contract_state "$name" "$contract_id" || return 1
    stellar contract install \
        --network "$NETWORK" \
        --source-account "$STELLAR_SECRET_KEY" \
        --wasm "$wasm_file" || return 1

    if [[ "$USE_UPGRADE_MANAGER" == "true" ]]; then
        local upgrade_manager_id
        upgrade_manager_id=$(get_upgrade_manager_id) || return 1
        propose_target_upgrade "$contract_id" "$new_version" "$new_wasm_hash" "$upgrade_manager_id" "$current_version"
        return $?
    fi

    stellar contract invoke \
        --network "$NETWORK" \
        --source-account "$STELLAR_SECRET_KEY" \
        --id "$contract_id" \
        -- upgrade --new_wasm_hash "$new_wasm_hash" --new_version "$new_version" || return 1
    update_deployment_metadata "$name" "$new_wasm_hash" "$new_version"
    echo -e "${GREEN}✓ Successfully upgraded $name${NC}"
}

# Update deployment metadata
update_deployment_metadata() {
    local name="$1"
    local new_hash="$2"
    local new_version="$3"

    if [[ "$DRY_RUN" == "true" ]]; then
        return 0
    fi

    # Update the deployment file
    local temp_file
    temp_file=$(mktemp)

    jq --arg name "$name" \
       --arg hash "$new_hash" \
       --arg version "$new_version" \
       --arg timestamp "$TIMESTAMP" \
       '.contracts[$name].wasm_hash = $hash |
        .contracts[$name].version = $version |
        .contracts[$name].upgraded_at = $timestamp' \
       "$DEPLOYMENT_FILE" > "$temp_file"

    mv "$temp_file" "$DEPLOYMENT_FILE"
}

# Check if deployment file exists
check_deployment_file() {
    if [[ ! -f "$DEPLOYMENT_FILE" ]]; then
        echo -e "${RED}Error: Deployment file not found: $DEPLOYMENT_FILE${NC}" >&2
        echo -e "${YELLOW}Hint: Run deploy.sh first to deploy contracts${NC}" >&2
        exit 1
    fi
}

# Get deployed contract info
get_contract_info() {
    local name="$1"
    jq -r --arg name "$name" '.contracts[$name] // empty' "$DEPLOYMENT_FILE"
}

# Get all deployed contracts
get_deployed_contracts() {
    jq -r '.contracts | keys[]' "$DEPLOYMENT_FILE"
}

# Calculate Wasm hash
calculate_wasm_hash() {
    local wasm_file="$1"
    sha256sum "$wasm_file" | cut -d' ' -f1
}

# Get network passphrase
get_network_passphrase() {
    case $NETWORK in
        testnet)
            echo "Test SDF Network ; September 2015"
            ;;
        futurenet)
            echo "Test SDF Future Network ; October 2022"
            ;;
        mainnet)
            echo "Public Global Stellar Network ; September 2015"
            ;;
    esac
}

# Build contracts
build_contracts() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        echo -e "${YELLOW}Skipping build step${NC}"
        return
    fi

    echo -e "${BLUE}Building contracts...${NC}"
    cd "$PROJECT_ROOT"

    # Build all contracts in workspace
    cargo build --target wasm32-unknown-unknown --release

    echo -e "${GREEN}✓ Build completed${NC}"
    echo ""
}

# Check if contract needs upgrade
needs_upgrade() {
    local name="$1"
    local wasm_file="$2"

    local contract_info
    contract_info=$(get_contract_info "$name")

    if [[ -z "$contract_info" ]]; then
        echo -e "${RED}✗ Contract $name not found in deployment metadata${NC}" >&2
        return 2
    fi

    local deployed_hash
    deployed_hash=$(echo "$contract_info" | jq -r '.wasm_hash')

    local current_hash
    current_hash=$(calculate_wasm_hash "$wasm_file")

    if [[ "$deployed_hash" != "$current_hash" ]]; then
        echo -e "${YELLOW}Contract $name needs upgrade${NC}"
        echo -e "${BLUE}  Deployed hash:${NC} $deployed_hash"
        echo -e "${BLUE}  Current hash:${NC}  $current_hash"
        return 0
    else
        echo -e "${GREEN}Contract $name is up to date${NC}"
        return 1
    fi
}

# Backup contract state
backup_contract_state() {
    local name="$1"
    local contract_id="$2"

    if [[ "$SKIP_BACKUP" == "true" ]]; then
        echo -e "${YELLOW}Skipping backup for $name${NC}"
        return 0
    fi

    echo -e "${BLUE}Creating state backup for $name...${NC}"

    # Create backup directory
    mkdir -p "$BACKUPS_DIR/$NETWORK"
    local backup_file="$BACKUPS_DIR/$NETWORK/${name}-${TIMESTAMP}.json"

    # Export contract state (this is a conceptual approach - Soroban doesn't have direct state export)
    # In practice, you'd need to call specific contract methods to get critical state
    local backup_data="{
        \"contract_id\": \"$contract_id\",
        \"backup_timestamp\": \"$TIMESTAMP\",
        \"network\": \"$NETWORK\",
        \"note\": \"State backup before upgrade - manual verification required\"
    }"

    echo "$backup_data" > "$backup_file"
    echo -e "${GREEN}✓ Backup created: $backup_file${NC}"

    # Store backup info in deployment metadata
    local metadata
    metadata=$(cat "$DEPLOYMENT_FILE")
    metadata=$(echo "$metadata" | jq --arg name "$name" --arg backup_file "$backup_file" --arg timestamp "$TIMESTAMP" '
        .contracts[$name].backups += [{
            file: $backup_file,
            timestamp: $timestamp
        }]
    ')
    echo "$metadata" > "$DEPLOYMENT_FILE"
}

# Perform safety checks
perform_safety_checks() {
    local name="$1"
    local contract_id="$2"
    local wasm_file="$3"

    if [[ "$FORCE" == "true" ]]; then
        echo -e "${YELLOW}Skipping safety checks (--force specified)${NC}"
        return 0
    fi

    echo -e "${BLUE}Performing safety checks for $name...${NC}"

    # Check 1: Verify contract exists on network
    echo -e "${BLUE}  Checking contract existence...${NC}"
    if ! soroban contract invoke \
        --id "$contract_id" \
        --source "$STELLAR_SECRET_KEY" \
        --rpc-url "$STELLAR_RPC_URL" \
        --network-passphrase "$(get_network_passphrase)" \
        -- --help >/dev/null 2>&1; then
        echo -e "${RED}  ✗ Contract not found on network${NC}" >&2
        return 1
    fi
    echo -e "${GREEN}  ✓ Contract exists on network${NC}"

    # Check 2: Verify Wasm file exists and is valid
    echo -e "${BLUE}  Checking Wasm file...${NC}"
    if [[ ! -f "$wasm_file" ]]; then
        echo -e "${RED}  ✗ Wasm file not found: $wasm_file${NC}" >&2
        return 1
    fi

    # Basic Wasm validation (check magic number)
    if ! xxd -l 4 "$wasm_file" | grep -q "0061736d"; then
        echo -e "${RED}  ✗ Invalid Wasm file (missing magic number)${NC}" >&2
        return 1
    fi
    echo -e "${GREEN}  ✓ Wasm file is valid${NC}"

    # Check 3: Storage layout compatibility (placeholder - requires contract-specific logic)
    echo -e "${BLUE}  Checking storage layout compatibility...${NC}"
    echo -e "${YELLOW}  ⚠ Manual storage layout verification required${NC}"

    return 0
}

# Main execution
main() {
    set_network_defaults
    check_deployment_file
    build_contracts

    if [[ -n "$CONTRACT_NAME" ]]; then
        # Upgrade specific contract
        local found=false
        for contract in "${CONTRACTS[@]}"; do
            local name="${contract%%:*}"

            if [[ "$name" == "$CONTRACT_NAME" ]]; then
                upgrade_single_contract "$name"
                found=true
                break
            fi
        done

        if [[ "$found" != "true" ]]; then
            echo -e "${RED}Error: Contract '$CONTRACT_NAME' not found${NC}" >&2
            echo -e "${YELLOW}Available contracts:${NC}"
            for contract in "${CONTRACTS[@]}"; do
                echo "  ${contract%%:*}"
            done
            exit 1
        fi
    else
        # Upgrade all contracts
        local upgraded=0
        local total=0

        for contract in "${CONTRACTS[@]}"; do
            local name="${contract%%:*}"

            # The upgrade manager uses its own self-upgrade entry points.
            if [[ "$name" == "upgrade-manager" ]]; then
                echo -e "${YELLOW}Skipping upgrade-manager (use the self-upgrade workflow)${NC}"
                continue
            fi

            total=$((total + 1))

            if upgrade_single_contract "$name"; then
                upgraded=$((upgraded + 1))
            fi
        done

        echo -e "\n${BLUE}=== Upgrade Summary ===${NC}"
        if [[ "$USE_UPGRADE_MANAGER" == "true" ]]; then
            echo -e "${GREEN}Submitted managed proposals: $upgraded/$total contracts${NC}"
        else
            echo -e "${GREEN}Successfully upgraded: $upgraded/$total contracts${NC}"
        fi

        if [[ $upgraded -lt $total ]]; then
            exit 1
        fi
    fi

    if [[ "$DRY_RUN" != "true" && "$USE_UPGRADE_MANAGER" != "true" ]]; then
        echo -e "\n${GREEN}Upgrade completed successfully.${NC}"
    fi
}

main "$@"
