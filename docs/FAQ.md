# Troubleshooting FAQ

Use the error text or category to find the relevant entry.

## Local development

### Bind for 0.0.0.0:5432 failed: port is already allocated

**Symptom.** Docker reports an address-in-use error on port 5432.

**Root cause.** The root Compose file uses SQLite and publishes no PostgreSQL port. An override, another Compose project, or a host PostgreSQL service may own it.

**Solution.**

1. Run `docker compose config` to find where the port is declared.
2. Identify the owner with `docker ps --filter publish=5432` or `lsof -nP -iTCP:5432 -sTCP:LISTEN`.
3. Remove an unnecessary publication from your override or change its host mapping to `5433:5432` and update host clients.
4. Container clients should use the service name and port 5432.

### SQLITE_CANTOPEN: unable to open database file

**Symptom.** Backend startup fails before the API is ready.

**Root cause.** The SQLite directory is missing or the backend process cannot write to it. SQLite also writes journal or WAL files beside the database.

**Solution.**

1. Check `DATABASE_URL` and the process working directory.
2. For the default host path, run `mkdir -p backend/data` from the repository root.
3. Give the backend user write access to the parent and database.
4. In Compose inspect the mounted `backend_data` volume and its ownership.
5. Preserve any existing DB and WAL files.

### VENICE_API_KEY is required

**Symptom.** Backend configuration validation fails during startup.

**Root cause.** The backend environment lacks a nonempty Venice key. Stellar secret keys and contract addresses are needed by some flows and are network-specific.

**Solution.**

1. Copy each service's `.env.example` to a local configuration file.
2. Load the backend variables into the shell or service environment before starting it.
3. Obtain `VENICE_API_KEY` from Venice API settings.
4. Configure the network, endpoints and any required coordinator account and deployed contract IDs for your flow.
5. Set `VITE_API_BASE_URL` in the frontend environment and restart Vite.

### Cannot find module after git pull

**Symptom.** The development process exits with `MODULE_NOT_FOUND` following an update.

**Root cause.** Installed dependencies or generated output no longer match the checked-in lockfile and code.

**Solution.**

1. Check which package owns the failing script and switch to the supported Node version.
2. Run `npm ci` in the package with the corresponding lockfile, then restart.
3. If the missing path is a local build artifact, rebuild its owning package.

### TS2307: Cannot find module or its corresponding type declarations

**Symptom.** Backend compilation fails after dependency changes.

**Root cause.** An installed dependency, its types, or its supported export paths changed.

**Solution.**

1. Run `npm ci` in `backend` and run `npm run typecheck` to locate the first failure.
2. Inspect the dependency version and its exported types.
3. Use the supported import or restore the lockfile version if the change was accidental.

### Backend changes do not hot reload

**Symptom.** Editing a route leaves the old response active.

**Root cause.** The backend `dev` script runs `ts-node src/index.ts` without a file watcher.

**Solution.**

1. Restart `npm run dev` after changes.
2. In Compose use `docker compose restart backend` and check `docker compose logs backend`.
3. Confirm the file is inside the mounted backend directory.

### Blank frontend page with no console errors

**Symptom.** The browser shows an empty view and the console has no obvious error.

**Root cause.** The URL may point to the backend, a stale build, or a deployment missing its frontend assets or SPA route fallback.

**Solution.**

1. Open the Vite URL printed at startup (port 5173 in Compose).
2. Use the Network tab to confirm the HTML and JavaScript return HTTP 200 with the correct content types.
3. Verify the API URL, disable stale cache while diagnosing, and configure an SPA fallback for deep links on the static host.

### cargo build fails on Apple Silicon

**Symptom.** A build reports an unsupported architecture, missing target, or linker failure.

**Root cause.** The shell, installed Rust toolchain, and native dependencies may target different host architectures. Soroban contracts also require a Wasm compilation target independently of the host.

**Solution.**

1. Check `uname -m` and the host in `rustc -vV`.
2. Install the repository workflow's Rust version and Wasm target with rustup.
3. Use native ARM dependencies in an ARM shell or keep the entire build in one x86_64 environment.
4. Use `stellar contract build` for deployment Wasm.

### ECONNREFUSED 127.0.0.1:6379

**Symptom.** Redis clients report a refused connection when the backend starts.

**Root cause.** Redis is stopped or `localhost` refers to the backend container itself.

**Solution.**

1. Start Redis with `docker compose up -d redis` and check `docker compose exec redis redis-cli ping`.
2. A host backend uses `redis://localhost:6379` with the default mapping.
3. The Compose backend uses `redis://redis:6379`.

### SyntaxError: Cannot use import statement outside a module

**Symptom.** Jest stops loading a spec or dependency before assertions run.

**Root cause.** The file was loaded without the matching TypeScript or ESM transform.

**Solution.**

1. Run the package's test script from `backend` so it loads the checked-in Jest config.
2. Find the offending file in the stack.
3. For a TypeScript source, check `ts-jest` and the selected Jest project.
4. For a dependency that ships ESM, use its supported CommonJS export or configure the transform for that dependency.

## Stellar and testnet

See [Stellar networks](https://developers.stellar.org/docs/networks), [Horizon accounts](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts), and [Stellar status](https://status.stellar.org/).

### Friendbot returns HTTP 400 or account already funded

**Symptom.** Friendbot rejects a funding request for a public account.

**Root cause.** The account may already exist or the supplied address or network is invalid.

**Solution.**

1. Check the response body and query `/accounts/<PUBLIC_KEY>` on testnet Horizon.
2. For a funded account, use the existing balance or transfer testnet XLM from another funded testnet account.
3. For an invalid request, verify the public key and Friendbot network.

### Friendbot rate limit or HTTP 429

**Symptom.** Funding fails after repeated requests.

**Root cause.** The shared faucet or its gateway throttles requests, including traffic sharing an IP.

**Solution.**

1. Honor `Retry-After` when present and back off with jitter.
2. Reuse funded accounts and avoid launching many parallel faucet requests.
3. Confirm the account state before retrying.

### Account not found or HTTP 404 from Horizon

**Symptom.** The account lookup fails before transaction submission.

**Root cause.** The account has not been created on the selected network, was removed by a testnet reset, or Horizon has yet to ingest the funding ledger.

**Solution.**

1. Match the wallet, Horizon URL and transaction passphrase to the same network.
2. Fund the testnet public address if needed, wait for the funding ledger, then reload the account before building the transaction.

### Insufficient balance when staking

**Symptom.** Staking fails even though the account displays a positive XLM balance.

**Root cause.** Spendable balance excludes minimum reserve, selling liabilities, and transaction fees. Contract execution may also add resource fees.

**Solution.**

1. Inspect balances and liabilities via Horizon and simulate the stake.
2. Calculate available XLM after reserve and fees.
3. Fund the difference or lower the stake, then rebuild and simulate.

### tx_bad_seq or sequence number mismatch

**Symptom.** Horizon rejects a signed transaction with `tx_bad_seq`.

**Root cause.** The transaction used a stale sequence, or multiple writers built transactions from the same source account state.

**Solution.**

1. Look up the original transaction first if submission was ambiguous.
2. Reload the source account, rebuild and re-sign using the fresh sequence.
3. Serialize writers for the same source account.

### HTTP 503 Service Unavailable from testnet Horizon

**Symptom.** A lookup or submission receives a 503.

**Root cause.** Horizon or an upstream gateway may be temporarily unavailable or lagging.

**Solution.**

1. Check the Stellar status page and the Horizon instance's root endpoint.
2. Retry reads with backoff.
3. For a submission, look up its hash and reconcile the outcome before submitting a replacement.

### Testnet XLM cannot cover base reserve plus staking

**Symptom.** A simulated or submitted stake runs short of XLM despite enough balance for the nominal stake.

**Root cause.** The account must also retain its protocol reserve and pay fees. Sponsorship and reserve-bearing subentries affect the minimum.

**Solution.**

1. Read the latest ledger base reserve and account sponsorship and subentry counts.
2. Compute the minimum as `(2 + subentry_count + num_sponsoring - num_sponsored) * base_reserve`.
3. Add selling liabilities, stake and fees to find the funding target.
4. Top up the test account and simulate again.

### Claimable balance not found by ID

**Symptom.** Horizon returns 404 for `/claimable_balances/<ID>`.

**Root cause.** The ID may be from another network, the creation ledger may still be ingesting, or the balance may already have been claimed.

**Solution.**

1. Load the creation operation on the same network and copy the full claimable-balance ID.
2. Check the claimant list with `/claimable_balances?claimant=<PUBLIC_KEY>` and inspect operation history for a successful claim.

## Smart contracts

See [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) and [Stellar storage and TTL](https://developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage).

### exceeds maximum contract size

**Symptom.** Uploading the Wasm fails with a size-limit error.

**Root cause.** The binary exceeds the active network's contract Wasm limit.

**Solution.**

1. Build release Wasm with the workspace settings.
2. Use `stellar contract optimize --help` for your installed CLI, optimize the artifact and recheck the upload size.
3. If it remains oversized, reduce dependencies or separate functionality across contracts before rebuilding.

### unauthorized during contract upgrade

**Symptom.** Upgrade simulation or submission fails authorization.

**Root cause.** The configured admin or governance account differs from the signer, or required contract authorization is absent.

**Solution.**

1. Verify the network and contract ID, then query its admin or governance configuration.
2. Simulate using the correct authorized workflow and collect required signatures before submitting.

### Error(Contract, #7)

**Symptom.** Simulation reports contract error code 7.

**Root cause.** Error numbers are scoped to the emitting contract and deployed version.

**Solution.**

1. Inspect the simulation trace to identify the failing contract, then find its `#[contracterror]` enum in the deployed source or contract spec.
2. For example, task_store code 7 is `NotAssignedAgent` and dispute_resolution code 7 is `AlreadyVoted`.
3. Fix the failed condition identified there.

### stellar contract invoke times out

**Symptom.** The CLI stops waiting for a testnet invocation.

**Root cause.** RPC may be slow, the transaction may still be pending, or the source account may have another transaction in flight.

**Solution.**

1. Check the RPC health and look up the printed transaction hash via `getTransaction`.
2. Wait for a definitive result within the transaction's validity window.
3. Re-simulate and submit a fresh transaction only after reconciling the old attempt.

### Contract storage entry unexpectedly returns None

**Symptom.** A previously written record or configuration is absent in a read.

**Root cause.** The key may be wrong, the contract may hide expired records, or the entry's TTL may have elapsed.

**Solution.**

1. Verify the network, contract ID, key and storage durability.
2. Inspect ledger entry state and the contract's own expiry policy.
3. Restore archived persistent entries as indicated by simulation, then extend TTL.
4. Recreate expired temporary data through the normal write flow.

### WASM upload fails with a network error

**Symptom.** CLI upload returns a transport, proxy, or gateway error.

**Root cause.** The configured RPC endpoint may be unavailable, or the client may have lost the response after sending.

**Solution.**

1. Confirm the endpoint and RPC health.
2. If a transaction hash was printed, check its status first.
3. Use bounded retries for transient transport failures and verify the uploaded Wasm hash before deploying.

## Venice AI

See the [Venice API reference](https://docs.venice.ai/api-reference/api-spec), [structured responses](https://docs.venice.ai/guides/features/structured-responses), and the [live text-model catalog](https://api.venice.ai/api/v1/models?type=text).

### HTTP 401 Unauthorized from Venice

**Symptom.** Chat requests return 401.

**Root cause.** The request has a missing, revoked, or malformed API key.

**Solution.**

1. Create or rotate the key in Venice API settings.
2. Put the raw key in `VENICE_API_KEY` without a `Bearer` prefix.
3. The client sends `Authorization: Bearer <key>`.
4. Verify `VENICE_BASE_URL=https://api.venice.ai/api/v1` and restart the backend.

### Venice request timed out after 10000ms

**Symptom.** The backend abandons a completion during an upstream call.

**Root cause.** Slow inference or a network issue exceeded the client's per-call timeout.

**Solution.**

1. Check provider latency and reduce prompt and output size.
2. The client defaults to ten seconds.
3. In callers that construct `VeniceClient`, increase its `timeoutMs` option if necessary, for example to 20 seconds for measured slow workloads.
4. Leave room for bounded retries within the overall request deadline.

### Unexpected token while parsing Venice JSON output

**Symptom.** The response envelope is valid JSON, but the assistant content fails JSON parsing.

**Root cause.** The model may lack structured-output support, the output may be truncated, or the request may omit the correct response format.

**Solution.**

1. Select a model that supports structured responses and send `response_format` with a JSON schema.
2. Check `finish_reason`, parse the assistant content and validate the schema.
3. On truncation adjust the token budget.
4. Retry a small bounded number of times, then surface a validation error.

### Model not found

**Symptom.** Venice rejects a model ID or alias.

**Root cause.** The ID was mistyped, removed, or is unavailable for the selected endpoint.

**Solution.**

1. Query `GET https://api.venice.ai/api/v1/models?type=text` and use the returned exact `id` of a model supporting the required features.
2. Update the model option in the caller and send a small request to confirm it.
3. Use the live catalog when replacing a deprecated ID.

## Frontend

### Freighter extension is not installed or not connected

**Symptom.** The connect control cannot detect Freighter, or `window.freighter` is undefined.

**Root cause.** The extension may be disabled, unavailable to the current browser profile, or locked. ai-net detects it through `@stellar/freighter-api`.

**Solution.**

1. Enable Freighter in the current profile, grant site access and unlock it.
2. Reload the application and reconnect.
3. Use the result of the SDK's `isConnected()` when debugging detection.

### Wallet connects and immediately disconnects

**Symptom.** A public address appears briefly and is lost.

**Root cause.** The extension access request may be rejected or session state may be reset by navigation, blocked storage, or a different browser origin.

**Solution.**

1. Open Freighter, confirm the selected account and approve site access.
2. Reload the same origin and check storage and console logs.
3. Confirm wallet, backend and contract network settings agree before retrying.

### Blocked by CORS policy

**Symptom.** The browser blocks frontend API requests even though curl succeeds.

**Root cause.** The frontend origin, including its scheme and port, is absent from the backend allowlist.

**Solution.**

1. Read the browser's `Origin` header and add it to backend `ALLOWED_ORIGINS`.
2. Restart the backend, confirm `VITE_API_BASE_URL` points at the right server and inspect the preflight response.

### Task status does not update in real time

**Symptom.** The task exists but the progress view stops updating.

**Root cause.** The socket upgrade, task-owner handshake, or heartbeat may fail.

**Solution.**

1. Inspect the Network tab for HTTP 101 at `/tasks/<id>/stream`.
2. Check that the first JSON frame sends the task owner's `walletPublicKey` and the client answers JSON ping with pong.
3. Use `wss://` behind HTTPS, forward upgrades through your proxy, and reconnect with `lastEventId` set to the last processed sequence.
