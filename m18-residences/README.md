# M18 Residences e2e

Drives the real stack in Google Chrome: the API Worker (`m18-residences-server`, run by `wrangler dev` in the real Workers runtime), the admin app (`M18-Residences-Admin`) and the tenant app (`M18-Residences`), against a throwaway local D1 database and R2 bucket (`.wrangler-e2e/`).

| | Port |
|---|---|
| API | 51000 |
| Admin app | 51001 |
| Tenant app | 51002 |

(Dev uses 50000–50002, so a running dev setup is left alone; `prepare.mjs` refuses to start if the e2e ports are busy.)

## Run locally

Prerequisites: the repos checked out as siblings of this repo's parent (e.g. `C:\dev\...`), Rust with the `wasm32-unknown-unknown` target and `worker-build` (`cargo install worker-build`), Flutter, Node 22 and Google Chrome. No database server is needed.

```sh
npm ci
npm run e2e        # prepare (fresh local D1, build the Worker + both apps) then run the specs
npm run test:fresh # fresh local D1 only, then run the specs against the last builds (fast loop when editing specs)
npm test           # run the specs as-is (the data from a previous run is still there)
```

Each run's D1 and R2 live in `.wrangler-e2e/` (gitignored, wiped by `prepare.mjs`), never in the server's own `.wrangler/` dev state. The API gets e2e-only configuration through `wrangler dev --env-file` (admin `e2e-admin` / `e2e-password`, overridable with `E2E_ADMIN_USERNAME`, `E2E_ADMIN_PASSWORD`, `E2E_JWT_SECRET`).

## How it works

- `prepare.mjs` runs first (Playwright starts web servers before `globalSetup`): creates a fresh local D1 with the server's migrations (`wrangler d1 migrations apply --local --persist-to`), builds the Worker (`worker-build --release`) and builds both apps with `--release --dart-define=API_URL=http://localhost:51000/api --dart-define=E2E=true`. Playwright then starts `wrangler dev` (the pinned wrangler in `package.json`) on 51000 and serves the app builds on 51001/51002.
- `E2E=true` makes the apps enable Flutter's accessibility tree, which is what Playwright reads. Tests find widgets by role/label or by `Semantics(identifier:)` ids, exposed as the `flt-semantics-identifier` attribute (`testIdAttribute`).
- Specs run in order with one worker: `1-auth` → `2-admin-flow` (room → tenant → reading → bill, then a ~9 MB photo attached as the receipt: the admin app must shrink it and send WebP) → `3-tenant-flow` (the tenant sees that bill and opens the receipt through its signed link).

## CI

`.github/workflows/m18-residences.yml` — run it from the Actions tab (choose the branch/tag of each repo) or call it from another repo's workflow with `uses: whatever413y/shared-e2e/.github/workflows/m18-residences.yml@main`. With `pinned: true` the apps build against the `m18_residences_shared` tag they pin (what deploys ship) instead of a `shared-packages` checkout; `e2e_ref` picks the specs' version.
