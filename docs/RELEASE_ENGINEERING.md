# Release Engineering Guide

This document covers the release process for ai-net across backend, frontend,
and smart-contract tracks.

---

## Semantic Versioning

ai-net follows [SemVer 2.0.0](https://semver.org/):

- **MAJOR** — Breaking changes to APIs, contract interfaces, or storage layouts.
- **MINOR** — New features, backward-compatible.
- **PATCH** — Bug fixes, backward-compatible.

Smart contracts use SemVer on the `stellar-cli` deploy metadata. The on-chain
contract name stays the same; the version is recorded in deployment JSON.

---

## Tagging Convention

Tags follow the pattern `v<MAJOR>.<MINOR>.<PATCH>`:

```bash
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

Use annotated tags (`-a`) so the tag message is stored. Tags are immutable
once pushed.

---

## Changelog Generation

The project uses [Conventional Commits](https://www.conventionalcommits.org/)
and [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Changelog entries
use these sections:

- **Added** — new functionality (`feat:`)
- **Changed** — performance, documentation, refactors, and maintenance
- **Deprecated** — features scheduled for removal
- **Removed** — removed features and reverted changes
- **Fixed** — resolved defects (`fix:`)
- **Security** — security improvements

### Generate changelog locally

```bash
npm run changelog
```

This updates `CHANGELOG.md` from conventional commits without creating a version
commit or tag. Release Please runs on pushes to `main` and opens or updates a
release PR with the version bump and generated changelog; merging that PR creates
the release tag.

---

## Release Checklist

### 1. Pre-release

- [ ] All CI checks passing on `main`
- [ ] No open critical/blocking issues tagged for this release
- [ ] `CHANGELOG.md` updated with release notes
- [ ] Version bumped in relevant files (package.json, Cargo.toml, etc.)

### 2. Backend

- [ ] `cd backend && npm run lint && npm test`
- [ ] Build production bundle: `npm run build`
- [ ] Verify no secrets in build output

### 3. Frontend

- [ ] `cd frontend && npm run lint && npm run build`
- [ ] Verify no secrets in build output

### 4. Smart Contracts

- [ ] `cd smart-contracts && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
- [ ] Build Wasm artifacts: `cargo build --target wasm32-unknown-unknown --release`
- [ ] Generate SHA256 checksums for all `.wasm` files

### 5. Tag & Release

- [ ] Create annotated tag: `git tag -a v<VERSION> -m "Release v<VERSION>"`
- [ ] Push tag: `git push origin v<VERSION>`
- [ ] Create GitHub Release with changelog notes
- [ ] Attach Wasm artifacts and SHA256SUMS to release

### 6. Post-release

- [ ] Deploy contracts to testnet (verify)
- [ ] Deploy contracts to mainnet (if applicable)
- [ ] Update deployment JSON with new contract addresses
- [ ] Monitor for 24h after mainnet deploy

---

## Artifact Signing & Verification

### SHA256SUMS

Every release includes a `SHA256SUMS` file for integrity verification:

```bash
# Generate checksums for all Wasm artifacts
cd smart-contracts/contracts
find . -name "*.wasm" -exec sha256sum {} \; > SHA256SUMS

# Verify a downloaded artifact
sha256sum -c SHA256SUMS
```

### SBOM (Software Bill of Materials)

Every GitHub Release includes SBOM artifacts (`sbom-root.json`, `sbom-frontend.json`, `sbom-backend.json`) generated automatically by the `smart-contracts.yml` release workflow using `@cyclonedx/cyclonedx-npm`. These files enumerate all npm dependencies in CycloneDX JSON format and allow downstream users to audit the full dependency tree.

```bash
# Manually generate the SBOM for the root workspace
npm ci --ignore-scripts
npx @cyclonedx/cyclonedx-npm --output-format JSON --output-file sbom.json

# Validate the SBOM with cyclonedx-cli (optional)
cyclonedx validate --input-file sbom.json --input-format json
```

### Security Audits

Automated security audits run on every PR via CI:

```bash
# npm audit — fails on high/critical CVEs
npm audit --audit-level=high          # root
cd frontend && npm audit --audit-level=high
cd backend && npm audit --audit-level=high

# Cargo audit — fails on high/critical CVEs in Rust dependencies
cd smart-contracts && cargo audit
```

Dependabot is configured to automatically raise PRs for outdated or vulnerable dependencies on a weekly schedule (see `.github/dependabot.yml`). Security alert PRs should be treated with the same rigor as production code — review, test, and merge promptly.

### Wasm Artifact Verification

After downloading a release artifact:

```bash
# 1. Verify checksum
sha256sum -c SHA256SUMS

# 2. Verify the Wasm module has correct imports
stellar contract inspect <artifact.wasm>

# 3. Deploy and verify on testnet before mainnet
./scripts/deploy.sh --network testnet
./scripts/verify.sh --network testnet
```

---

## Contract Upgrade Coordination

When upgrading deployed contracts:

1. **Testnet first** — always deploy to testnet and run full E2E tests.
2. **Announce** — notify stakeholders at least 48h before mainnet upgrade.
3. **Upgrade via upgrade-manager** — use the `upgrade.sh` script with the
   upgrade-manager contract for safe upgrades with rollback window.
4. **Verify** — run `verify.sh` post-upgrade to confirm storage and state.
5. **Monitor** — watch metrics for 24h post-upgrade.

```bash
# Dry run
./scripts/upgrade.sh --network mainnet --dry-run

# Upgrade
./scripts/upgrade.sh --network mainnet --use-upgrade-manager agent-registry

# Verify
./scripts/verify.sh --network mainnet
```

---

## Release Tracks

| Track           | Cadence                                      | Artifacts                  |
| --------------- | -------------------------------------------- | -------------------------- |
| Smart Contracts | On-demand (after audit or feature milestone) | `.wasm` files, SHA256SUMS  |
| Backend         | Bi-weekly or on critical fix                 | Docker image, npm package  |
| Frontend        | Bi-weekly or on critical fix                 | Static build, Docker image |

All tracks share the same SemVer and tagging convention. A single git tag
covers all tracks for a given version.

---

## Smart Contract Releases

Smart contract releases on Soroban have unique requirements beyond the standard release checklist: WASM compilation, contract ID management, testnet/mainnet separation, governance approval for breaking upgrades, and emergency hotfix procedures.

For the complete smart contract release workflow, upgrade safety checklist, governance approval process, and emergency hotfix procedure, see **[SMART_CONTRACT_RELEASE.md](./SMART_CONTRACT_RELEASE.md)**.

## Component Versioning and Approval

Use MAJOR.MINOR.PATCH. Increment MAJOR for a breaking change to any public
interface, MINOR for backward-compatible functionality, and PATCH for a
backward-compatible fix or documentation correction. Reset the lower fields
when incrementing MAJOR or MINOR.

| Component         | MAJOR                                                                             | MINOR                                                                   | PATCH                                                        |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Soroban contracts | Change a storage layout or authorization model, or remove a public function       | Add a backward-compatible entry point such as a read-only balance query | Fix internal arithmetic while preserving the ABI and storage |
| Backend API       | Remove a response field, make a request field mandatory, or change authentication | Add an endpoint while retaining supported routes                        | Correct validation to match the documented request contract  |
| SDK               | Drop support for an API version or remove a public method                         | Add a method for an endpoint while retaining supported API versions     | Fix response decoding without changing the public types      |

Record which SDK versions support each API version and which contract versions
the backend expects. A coordinated release tag identifies the source revision.
Record the individual component versions in the release notes as well.

| Release | Required approval | Deployment window and gates                                                                                                       |
| ------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Hotfix  | One maintainer    | Deploy immediately after approval and testing, outside the weekly window if necessary                                             |
| Minor   | Two maintainers   | Deploy in the weekly release window after the full test suite passes                                                              |
| Major   | All maintainers   | Allow 48 hours for review after the release PR merges. Deploy after review and require a security audit gate for contract changes |

Record the approval, the scheduled UTC deployment time, and any audit evidence
in the release PR.

## Generating and Curating the Changelog

Both release workflows consume Conventional Commits. Release Please reads
`.release-please-config.json` and `.release-please-manifest.json`. Semantic
Release reads `.releaserc.json`. Use the release workflow's preview command
from a full checkout of the release branch with the required GitHub access:

```bash
npm ci
npx semantic-release --dry-run
```

For a local Conventional Changelog preview, use the existing `.versionrc.json`
type mappings:

```bash
npx --yes --package=conventional-changelog-cli --package=conventional-changelog-conventionalcommits conventional-changelog -p conventionalcommits -c .versionrc.json -o /tmp/ai-net-changelog.md
```

The root package currently has no `npm run release` or `npm run changelog`
script. Use the checked-in workflows for publishing and choose one workflow to
own the tag for a given version. Docs-only commits are visible in the generated
notes and do not trigger Semantic Release on their own. If generated entries need
curation, edit the release PR's changelog section, group duplicate entries,
include deprecations and migration instructions, and review the diff before
merging. Copy that version's section into the GitHub release draft.

## Coordinated Release Checklist

1. Select component versions, the release type, and the deployment window.
2. Record contract, API, and SDK compatibility and the last known good versions.
3. Obtain the approvals for the release type and record the security audit for major contract changes.
4. Run the full CI suite for minor and major releases, including contract, API, and client integration checks. Run targeted regression and smoke checks for a hotfix.
5. Deploy and initialize on testnet and run the registration, task, and settlement smoke flow.
6. Verify the deployed contract IDs and update the deployment JSON and backend address configuration.
7. Update the TypeScript SDK version in `smart-contracts/package.json` and sync its lockfile when the SDK changes.
8. Update the API version defaults and supported versions as applicable. Check `API_DEFAULT_VERSION` and `API_SUPPORTED_VERSIONS` through `backend/src/api/middleware/versioning.ts`.
9. Review the generated changelog, curate the entries, and confirm the migration and rollback notes.
10. Prepare the GitHub release draft or release PR notes for the approved tag.
11. Build artifacts from the tagged revision, record image digests, generate checksums and SBOMs, and sign the final binaries.
12. Stage a backend build that can communicate with the current contracts and the target versions. Activate changed calls after the new contract addresses and smoke checks are confirmed.
13. Smoke-test the production API and publish the SDK only after its supported API versions are reachable.
14. Publish the GitHub release with the changelog, binaries, signatures, checksums, and deployment metadata.
15. Announce the release in Discord and monitor API errors, task settlement, and contract failures for 24 hours.

## Signing GitHub Release Assets

Create an organization-controlled release signing key on a restricted signing
machine. Back up the private key and revocation certificate offline and
distribute the full public fingerprint through a trusted project channel.

```bash
gpg --quick-generate-key 'ai-net Release Signing <release@example.org>' ed25519 sign 2y
gpg --list-keys --fingerprint 'ai-net Release Signing'
gpg --armor --export "$RELEASE_FINGERPRINT" > ai-net-release-key.asc
```

Replace the example identity with the project signing identity and set
`RELEASE_FINGERPRINT` to its full fingerprint. After all binaries and the
checksum manifest reach their final form, sign each asset and upload its
detached signature alongside it. Run this once per binary and for the manifest:

```bash
gpg --local-user "$RELEASE_FINGERPRINT" --output "$ASSET.sig" --detach-sign "$ASSET"
gh release upload "$TAG" "$ASSET" "$ASSET.sig"
```

Attach the public key as an asset as well. Existing CI builds artifacts and
checksums. Apply this signing procedure to the final assets and verify the
uploaded bytes before announcing their availability. Users can verify a
download with:

```bash
gpg --show-keys --fingerprint ai-net-release-key.asc
gpg --import ai-net-release-key.asc
gpg --verify "$ASSET.sig" "$ASSET"
sha256sum -c SHA256SUMS
```

Compare the displayed fingerprint to the independently published fingerprint
before importing. If the signature or checksum check fails, stop and notify
the maintainers.

## Deployment Order and Verification

Run the scripts from `smart-contracts/`. The checked-in `scripts/deploy.sh`
deploys four WASM modules in this order:

| Order | Contract      | Verification before activating a dependent                                                                                                      |
| ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | AgentRegistry | Confirm registration and lookup work before routing tasks to registered agents.                                                                 |
| 2     | TaskStore     | Confirm task creation and lookup. TaskStore currently initializes with an admin address and accepts no registry or escrow constructor argument. |
| 3     | PaymentEscrow | Confirm lock and release/refund on testnet before enabling task settlement. This is the repository's escrow contract.                           |
| 4     | ErrorResolver | Confirm its configured registry and a test resolution before enabling the resolution integration.                                               |

```bash
./scripts/deploy.sh --network testnet --verify
./scripts/verify.sh --network testnet
```

The deploy script records IDs and WASM hashes in `deployments/<network>.json`
and reports failed deployments at the end. Before enabling each integration,
compare the recorded ID and hash to the deployed instance, initialize it,
verify the configured dependency addresses, and invoke a read-only entry point
on the target network. Stop activation on any mismatch. If a future TaskStore
release introduces an on-chain escrow address, deploy and verify PaymentEscrow
before initializing that TaskStore and update the script when adding that
dependency.

For contracts outside the script's list, deploy shared configuration and
governance first, then wire consumers to verified addresses. In particular,
configure PaymentEscrow with the PlatformConfig address before enabling
config-backed settlement.

## Rollback and Communication

- **Backend** — Redeploy the previous known good Docker image by digest. Check
  migration compatibility before restoring it and verify health and task
  settlement on staging before directing production traffic to it.
- **API** — Disable the affected feature flag or route traffic back to the
  previous supported API version. Confirm response shapes and authentication
  with the affected clients.
- **Contracts** — If the deployed contract supports upgrades, use its approved
  rollback flow to restore the previous WASM hash. Verify storage compatibility,
  migration reversibility, and settlement before resuming traffic. For immutable
  contracts, communicate the workaround and coordinate migration to a verified
  replacement address.
- **SDK** — Deprecate the affected package version and tell users which previous
  version to pin. Publish a corrective patch after verifying it against the
  supported API versions.

Post an incident update in Discord and the release notes with the affected
versions and networks, visible symptoms, workaround, and time of the next
update. After rollback, confirm recovery in both places and identify the
versions and addresses now active.

Use the following GitHub release notes structure. Paste the curated changelog
directly under **Changes**.

```markdown
# ai-net v<VERSION>

## Changes

<Paste the curated changelog section for this version.>

## Compatibility and migration

<Contract IDs and versions by network, supported API and SDK versions, and migration steps.>

## Artifacts and verification

<Binaries, image digests, checksums, signatures, and signing key fingerprint.>

## Rollback

<Previous known good versions and any storage migration constraints.>
```

Discord announcement format:

```text
ai-net v<VERSION> is available on <network/environment>.
<One or two user-facing changes>
Action required — <migration or upgrade deadline, if applicable>
Release notes and signed artifacts — <GitHub release link>
Next status update — <UTC time, if applicable>
```
