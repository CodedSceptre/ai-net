## Summary
<!-- Briefly summarize the problem and solution. Please review CONTRIBUTING.md before opening. -->
Resolves #<issue-number>

## Changes
- 

## Verification & Testing
<!-- Describe unit/integration tests executed and commands used -->
- [ ] `npm test` (Backend/Frontend)
- [ ] `cargo test` (Smart Contracts)
- [ ] `cargo fmt --check && cargo clippy` (Contract Linting)

## Contributor Checklist
<!-- Ensure your contribution follows our guidelines in CONTRIBUTING.md -->
- [ ] PR title follows [Conventional Commits](CONTRIBUTING.md#3-conventional-commits-specification) (`feat:`, `fix:`, `docs:`, etc.)
- [ ] All CI checks pass locally
- [ ] Documentation updated in `docs/` or `README.md` if applicable
- [ ] No secrets or credentials committed

### Visual baselines

Run `cd frontend && npm run test:visual` to compare screenshots. Open the
`playwright-visual-report` CI artifact to review expected, actual, and diff images.
For intended changes, apply the `update-snapshots` label. CI commits regenerated
PNGs to same-repository PR branches. For a fork PR, download the
`visual-baselines` artifact, copy the reviewed PNGs to
`frontend/tests/visual/baselines/`, and commit them to the PR branch. Remove the
label after the update so subsequent runs compare against the committed images.
