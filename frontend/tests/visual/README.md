# Visual regression tests

The seven page specs capture the landing page, agent registry, agent detail,
task detail, wallet, payments, and dashboard in Chromium. Every page runs at
1280 × 800 desktop and 390 × 844 mobile sizes. The suite uses browser MSW
fixtures and compares screenshots with a maximum changed pixel ratio of 0.001.

From `frontend`, `npm run test:visual` starts the Vite dev server on port 5173.
Set `PLAYWRIGHT_BASE_URL` to use an existing Vite dev server. Open
`playwright-report-visual/index.html` for the report.

Regenerate screenshots after intentional changes with
`npm run test:visual:update` inside the Playwright container pinned in CI.
A same-repository PR labeled `update-snapshots` can also regenerate and commit
the reference PNGs. On a fork PR, download the CI run's `visual-baselines`
artifact and commit the reviewed images into `tests/visual/baselines/`.
