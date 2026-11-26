# Dependency Management

ai-net uses [Renovate Bot](https://docs.renovatebot.com/) to automate dependency updates across the monorepo. This document explains how the automation works, what gets automerged, and how to override behaviour for a specific package.

---

## How It Works

Renovate runs every weekend (Saturday 02:00 UTC via `.github/workflows/renovate.yml`) and scans all dependency manifests in the repository:

| Manager    | Files Scanned                                                       |
| ---------- | ------------------------------------------------------------------- |
| npm        | `package.json` in root, `backend/`, `frontend/`, `smart-contracts/` |
| Cargo      | `smart-contracts/Cargo.toml`                                        |
| Dockerfile | `Dockerfile`, `docker-compose.yml`                                  |
| Terraform  | `infra/**/*.tf`                                                     |

Renovate also maintains a **Dependency Dashboard** GitHub issue (auto-created on first run) that lists all pending, open, and ignored updates in one place.

---

## Automerge Rules

| Update Type                  | Manager    | Automerge? | Stability Days | Notes                                       |
| ---------------------------- | ---------- | ---------- | -------------- | ------------------------------------------- |
| Patch                        | npm        | ✅ Yes     | 3              | Squash-merged after CI passes               |
| Minor                        | npm        | ❌ No      | 3              | Grouped into one PR per directory           |
| Major                        | npm        | ❌ No      | —              | Assigned to `@CodedSceptre/devops`          |
| Patch / digest               | Dockerfile | ✅ Yes     | 3              | Squash-merged after CI passes               |
| Major                        | Dockerfile | ❌ No      | —              | Assigned to `@CodedSceptre/devops`          |
| Patch                        | Cargo      | ✅ Yes     | 3              | Squash-merged after CI passes               |
| Major                        | Cargo      | ❌ No      | —              | Assigned to `@CodedSceptre/devops`          |
| Patch                        | Terraform  | ✅ Yes     | 3              | Squash-merged after CI passes               |
| Major                        | Terraform  | ❌ No      | —              | Assigned to `@CodedSceptre/devops`          |
| `@stellar/stellar-sdk` (npm) | npm        | ❌ Never   | 7              | Requires manual review regardless of semver |
| `stellar-sdk` crate          | Cargo      | ❌ Never   | 7              | Requires manual review regardless of semver |
| Security advisory            | Any        | ❌ No      | 0              | PR opened immediately, no stability delay   |

**Stability days** mean Renovate waits that many days after a version is published before creating or merging a PR. This guards against yanked or broken day-zero releases.

---

## Security / Vulnerability Alerts

When a package has a published security advisory (via OSV or the GitHub Advisory Database), Renovate opens a PR immediately with:

- `stabilityDays: 0` — no waiting period
- Labels: `security`, `vulnerability`
- No automerge — a human must review and merge

---

## Stellar SDK Pin

The `@stellar/stellar-sdk` npm package and the `stellar-sdk` Cargo crate are pinned to **always require manual review**:

- `automerge: false` for every semver level (patch, minor, major)
- `stabilityDays: 7` to allow the ecosystem time to stabilise before the PR is even created
- Assigned to `@CodedSceptre/devops` for review

This protects against Stellar network protocol changes or breaking RPC API changes reaching production unreviewed.

---

## Overriding Automerge for a Specific Package

Add a `packageRules` entry to `renovate.json`:

```json
{
  "packageRules": [
    {
      "description": "Disable automerge for ioredis until v6 migration is complete",
      "matchPackageNames": ["ioredis"],
      "automerge": false,
      "stabilityDays": 14
    }
  ]
}
```

To **enable** automerge for a package that is otherwise manual (e.g. a pinned package you want to unpin):

```json
{
  "packageRules": [
    {
      "matchPackageNames": ["some-safe-package"],
      "matchUpdateTypes": ["patch"],
      "automerge": true,
      "stabilityDays": 3
    }
  ]
}
```

Package rules are applied in order, and **later rules take precedence** over earlier ones.

---

## Ignoring a Package Entirely

To stop Renovate from touching a package:

```json
{
  "packageRules": [
    {
      "matchPackageNames": ["legacy-package"],
      "enabled": false
    }
  ]
}
```

---

## Validating renovate.json

Before merging changes to `renovate.json`, run the validator locally:

```bash
npx --yes renovate-config-validator renovate.json
```

The workflow also re-runs Renovate on any push to `main` that modifies `renovate.json`, providing an immediate feedback loop.

---

## Dependency Dashboard

Renovate auto-creates and maintains a GitHub issue titled **"Renovate Dependency Dashboard"**. It lists:

- **Detected dependencies** — every dependency Renovate is managing
- **Pending updates** — updates that are waiting for stability days
- **Open PRs** — currently open Renovate PRs
- **Ignored / blocked** — updates you have deliberately skipped

Checking a box next to an update in the dashboard will immediately trigger a PR for that update, bypassing the weekend schedule.

---

## Running Renovate Manually

Go to **Actions → Renovate → Run workflow** in GitHub and click **Run workflow**. You can optionally set the log level to `debug` for verbose output.
