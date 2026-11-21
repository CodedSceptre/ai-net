## Summary

<!-- Briefly describe the problem and how this PR solves it. -->

Resolves #<!-- issue number -->

## What Was Changed

<!-- List the key changes made in this PR. Be specific. -->

- 
- 
- 

## Type of Change

<!-- Check all that apply -->

- [ ] `feat` — New feature or capability
- [ ] `fix` — Bug fix
- [ ] `docs` — Documentation only
- [ ] `test` — New or improved tests (no production code change)
- [ ] `refactor` — Code restructuring (no behavior change)
- [ ] `perf` — Performance improvement
- [ ] `ci` — CI/CD workflow change
- [ ] `chore` — Maintenance, dependency update, tooling

## Testing

<!-- Describe what you tested and how. Include commands run. -->

- [ ] `npm run gate` passes locally
- [ ] Relevant unit tests added or updated
- [ ] Integration tests updated (if backend API changed)
- [ ] Visual regression baselines updated (if frontend UI changed)

**Commands run:**

```bash
# e.g.
cd backend && npm run test:coverage
cd frontend && npm run build
```

## Checklist

<!-- Complete all items before requesting review -->

### All PRs
- [ ] PR title follows Conventional Commits format: `type(scope): description (#issue)`
- [ ] Branch is rebased on `upstream/main` with no conflicts
- [ ] No secrets, API keys, or `.env` files committed
- [ ] `npm run gate` passes (format + lint + typecheck + coverage)

### Backend (if applicable)
- [ ] `cd backend && npm run lint && npm run typecheck && npm run test:coverage`
- [ ] New endpoints documented in `docs/API_REFERENCE.md`
- [ ] Database schema changes include migration files

### Frontend (if applicable)
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build`
- [ ] Components are accessible (WCAG 2.1 AA — keyboard nav, ARIA labels)
- [ ] i18n keys added to both `en` and `zh` locale files

### Smart Contracts (if applicable)
- [ ] `cargo fmt --check && cargo clippy --all-targets -- -D warnings`
- [ ] `cargo test` passes for all affected contracts
- [ ] Every on-chain mutation calls `require_auth()`
- [ ] No unbounded vectors in contract storage

## Screenshots (if frontend change)

<!-- Add before/after screenshots for any UI changes. Delete this section if not applicable. -->

## Additional Context

<!-- Anything else reviewers should know? Architecture decisions, trade-offs, follow-up work? -->

### Visual baselines

Run `cd frontend && npm run test:visual` to compare screenshots. Open the
`playwright-visual-report` CI artifact to review expected, actual, and diff images.
For intended changes, apply the `update-snapshots` label. CI commits regenerated
PNGs to same-repository PR branches. For a fork PR, download the
`visual-baselines` artifact, copy the reviewed PNGs to
`frontend/tests/visual/baselines/`, and commit them to the PR branch. Remove the
label after the update so subsequent runs compare against the committed images.
