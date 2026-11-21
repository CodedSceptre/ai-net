#!/bin/bash
# deploy.sh — Deploy Soroban smart contracts in dependency order.
#
# Usage: ./deploy.sh [OPTIONS]
#   -n, --network   testnet | mainnet | standalone  (default: testnet)
#   -s, --skip-build  Skip the Wasm build step
#   -v, --verify      Run verify.sh after successful deployment
#   -h, --help        Show this help message
#
# Required environment variables:
#   STELLAR_SECRET_KEY     Account secret key for deployment
#
# Optional environment variables:
#   STELLAR_RPC_URL        Override default RPC endpoint
#   STELLAR_HORIZON_URL    Override default Horizon endpoint

set +x
set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Defaults ─────────────────────────────────────────────────────────────────
NETWORK="testnet"
SKIP_BUILD=false
VERIFY=false
DRY_RUN=false
WASM_TARGET="${WASM_TARGET:-wasm32-unknown-unknown}"

# ─── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${NC} $0 [OPTIONS]

Deploy Soroban contracts to the specified network in dependency order:
  Registry → TaskStore → PaymentEscrow

${BOLD}OPTIONS:${NC}
  -n, --network NETWORK     Target network: testnet | mainnet | standalone  [default: testnet]
      --dry-run             Validate the build artifacts without broadcasting
  -s, --skip-build          Skip the Wasm build step
  -v, --verify              Run verify.sh after successful deployment
  -h, --help                Show this help message

${BOLD}REQUIRED ENVIRONMENT VARIABLES:${NC}
  STELLAR_SECRET_KEY        Secret key for the deployment account

${BOLD}OPTIONAL ENVIRONMENT VARIABLES:${NC}
  STELLAR_RPC_URL           Override the default Soroban RPC endpoint
  STELLAR_HORIZON_URL       Override the default Horizon endpoint

${BOLD}EXAMPLES:${NC}
  $0                                Deploy to testnet
  $0 -n mainnet                     Deploy to mainnet
  $0 -n standalone -s               Deploy to standalone, skipping build
  $0 -v                             Deploy to testnet and run verification
EOF
}

# ─── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--network)
      NETWORK="$2"
      shift 2
      ;;
    -s|--skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -v|--verify)
      VERIFY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# ─── Validate network ─────────────────────────────────────────────────────────
case "$NETWORK" in
  testnet|mainnet|standalone) ;;
  *)
    echo -e "${RED}Error: Invalid network '${NETWORK}'. Must be: testnet | mainnet | standalone${NC}" >&2
    exit 1
    ;;
esac

# ─── Validate required environment variables ──────────────────────────────────
validate_env() {
  local missing=()

  [[ -z "${STELLAR_SECRET_KEY:-}" ]] && missing+=("STELLAR_SECRET_KEY")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo -e "${RED}${BOLD}Error: Missing required environment variable(s):${NC}" >&2
    for var in "${missing[@]}"; do
      echo -e "${RED}  • ${var}${NC}" >&2
    done
    echo "" >&2
    echo -e "${YELLOW}Hint: Copy .env.example to .env and fill in the required values, then:${NC}" >&2
    echo -e "${YELLOW}  export \$(grep -v '^#' .env | xargs)${NC}" >&2
    exit 1
  fi
}

# ─── Network defaults ─────────────────────────────────────────────────────────
set_network_defaults() {
  case "$NETWORK" in
    testnet)
      STELLAR_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
      STELLAR_HORIZON_URL="${STELLAR_HORIZON_URL:-https://horizon-testnet.stellar.org}"
      NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
      ;;
    mainnet)
      STELLAR_RPC_URL="${STELLAR_RPC_URL:-https://soroban-rpc.stellar.org}"
      STELLAR_HORIZON_URL="${STELLAR_HORIZON_URL:-https://horizon.stellar.org}"
      NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
      ;;
    standalone)
      STELLAR_RPC_URL="${STELLAR_RPC_URL:-http://localhost:8000/soroban/rpc}"
      STELLAR_HORIZON_URL="${STELLAR_HORIZON_URL:-http://localhost:8000}"
      NETWORK_PASSPHRASE="Standalone Network ; February 2017"
      ;;
  esac
  export STELLAR_RPC_URL STELLAR_HORIZON_URL
  export STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-$NETWORK_PASSPHRASE}"
}

# ─── Dependency check ─────────────────────────────────────────────────────────
check_dependencies() {
  local missing=()
  for dep in jq sha256sum stellar; do
    command -v "$dep" >/dev/null 2>&1 || missing+=("$dep")
  done
  if [[ "$SKIP_BUILD" == "false" ]] && ! command -v cargo >/dev/null 2>&1; then
    missing+=(cargo)
  fi
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo -e "${RED}Error: Required tools not found: ${missing[*]}${NC}" >&2
    exit 1
  fi
}

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOYMENTS_DIR="$PROJECT_ROOT/deployments"
TARGET_DIR="$PROJECT_ROOT/target/$WASM_TARGET/release"
DEPLOYMENT_FILE="$DEPLOYMENTS_DIR/${NETWORK}.json"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ─── Contract deployment order (Registry → TaskStore → PaymentEscrow) ─────────
# Format: "contract-name:wasm-filename-stem:path-hint"
# Contracts are deployed in this exact order to respect on-chain dependencies.
CONTRACTS=(
  "agent-registry:agent_registry:contracts/agent_registry"
  "task-store:task_store:contracts/task_store"
  "payment-escrow:payment_escrow:contracts/payment_escrow"
  "error-resolver:error_resolver:contracts/error-resolver"
  "error-registry:error_registry:contracts/error-registry"
  "agent-bidding:agent_bidding:contracts/agent_bidding"
  "agent-governance:agent_governance:contracts/agent_governance"
  "upgrade-manager:upgrade_manager:contracts/upgrade-manager"
  "multisig-governance:multisig_governance:contracts/multisig_governance"
  "platform-config:platform_config:contracts/platform_config"
  "agent-marketplace:agent_marketplace:contracts/agent_marketplace"
)

# ─── Helpers ─────────────────────────────────────────────────────────────────
log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}   $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

init_deployment_file() {
  mkdir -p "$DEPLOYMENTS_DIR"
  local existing="{}"
  [[ -f "$DEPLOYMENT_FILE" ]] && existing="$(cat "$DEPLOYMENT_FILE")"

  echo "$existing" | jq \
    --arg network "$NETWORK" \
    --arg rpc "$STELLAR_RPC_URL" \
    --arg horizon "$STELLAR_HORIZON_URL" \
    --arg ts "$TIMESTAMP" \
    '{
      network: $network,
      rpc_url: $rpc,
      horizon_url: $horizon,
      deployed_at: $ts,
      contracts: (.contracts // {}),
      deployment_history: (.deployment_history // [])
    }' > "$DEPLOYMENT_FILE"
}

# ─── Build ────────────────────────────────────────────────────────────────────
build_contracts() {
  if [[ "$SKIP_BUILD" == "true" ]]; then
    log_warn "Skipping Wasm build (--skip-build)"
    return 0
  fi

  log_info "Building contracts for $WASM_TARGET…"
  cd "$PROJECT_ROOT"
  if ! cargo build --workspace --locked --target "$WASM_TARGET" --release 2>&1; then
    log_error "cargo build failed"
    exit 1
  fi
  log_success "Contracts built"
  echo ""
}

redact_cli_output() {
  awk '
    function mask(line, secret, at, clean) {
      if (secret == "") return line
      while ((at = index(line, secret)) > 0) {
        clean = clean substr(line, 1, at - 1) "[REDACTED]"
        line = substr(line, at + length(secret))
      }
      return clean line
    }
    { print mask(mask($0, ENVIRON["STELLAR_SECRET_KEY"]), ENVIRON["STELLAR_NETWORK_PASSPHRASE"]) }
  '
}

deploy_contract() {
  local name="$1" wasm_stem="$2"
  local wasm_file="$TARGET_DIR/${wasm_stem}.wasm"
  if [[ ! -s "$wasm_file" ]]; then
    log_error "Missing Wasm artifact for $name"
    return 1
  fi
  local wasm_hash
  wasm_hash="$(sha256sum "$wasm_file" | cut -d' ' -f1)"
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "Validated $name ($wasm_hash)"
    return 0
  fi

  local salt contract_id output
  salt="$(printf '%s:%s' "$name" "$wasm_hash" | sha256sum | cut -d' ' -f1)"
  # The salt makes the address stable for this artifact even on a fresh runner.
  contract_id="$(stellar contract id wasm --salt "$salt" 2> >(redact_cli_output >&2))"
  if [[ ! "$contract_id" =~ ^C[A-Z2-7]{55}$ ]]; then
    log_error "Could not derive contract ID for $name"
    return 1
  fi
  if stellar contract fetch --id "$contract_id" >/dev/null 2>&1; then
    log_info "Reusing $name at $contract_id"
  else
    log_info "Deploying $name"
    output="$(stellar contract deploy --wasm "$wasm_file" --salt "$salt" 2> >(redact_cli_output >&2))"
    if [[ "$output" != "$contract_id" ]]; then
      log_error "Unexpected contract ID for $name"
      return 1
    fi
  fi

  local updated
  updated="$(jq --arg name "$name" --arg id "$contract_id" --arg hash "$wasm_hash" --arg ts "$TIMESTAMP" \
    '.contracts[$name] = { contract_id: $id, wasm_hash: $hash, deployed_at: $ts }' "$DEPLOYMENT_FILE")"
  printf '%s\n' "$updated" > "$DEPLOYMENT_FILE.tmp"
  mv "$DEPLOYMENT_FILE.tmp" "$DEPLOYMENT_FILE"
  log_success "$name: $contract_id"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo -e "${BOLD}${BLUE}═══ ai-net Smart Contract Deployment ═══${NC}"
  echo -e "Network    : ${BOLD}${NETWORK}${NC}"
  echo -e "RPC URL    : ${STELLAR_RPC_URL}"
  echo -e "Horizon URL: ${STELLAR_HORIZON_URL}"
  echo -e "Output     : ${DEPLOYMENT_FILE}"
  echo ""

  build_contracts
  stellar contract deploy --help >/dev/null
  stellar contract id wasm --help >/dev/null
  stellar contract fetch --help >/dev/null
  if [[ "$DRY_RUN" == "false" ]]; then
    init_deployment_file
  fi

  local entry name wasm_stem
  for entry in "${CONTRACTS[@]}"; do
    IFS=':' read -r name wasm_stem _path <<< "$entry"
    deploy_contract "$name" "$wasm_stem"
  done
  if [[ "$DRY_RUN" == "true" ]]; then
    log_success "Dry run completed"
    return 0
  fi

  # Record history
  local history_entry
  history_entry="$(cat "$DEPLOYMENT_FILE" | jq \
    --arg ts "$TIMESTAMP" \
    --arg net "$NETWORK" \
    '.deployment_history += [{ action: "deploy", timestamp: $ts, network: $net, contracts: (.contracts | keys) }]')"
  echo "$history_entry" > "$DEPLOYMENT_FILE"

  echo -e "${GREEN}${BOLD}═══ Deployment completed successfully ═══${NC}"
  echo -e "Deployment record saved to: ${BOLD}${DEPLOYMENT_FILE}${NC}"
  echo ""

  if [[ "$VERIFY" == "true" ]]; then
    log_info "Running verification…"
    "$SCRIPT_DIR/verify.sh" --network "$NETWORK"
  fi
}

if [[ "$DRY_RUN" == "false" ]]; then
  validate_env
  export STELLAR_ACCOUNT="$STELLAR_SECRET_KEY"
fi
check_dependencies
set_network_defaults
main "$@"
