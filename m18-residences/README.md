# M18 Residences e2e

Drives the real stack in Google Chrome: the Rust API (`m18-residences-server`), the admin app (`M18-Residences-Admin`) and the tenant app (`M18-Residences`), against a throwaway Postgres database `m18_e2e`.

| | Port |
|---|---|
| API | 51000 |
| Admin app | 51001 |
| Tenant app | 51002 |

(Dev uses 50000–50002, so a running dev setup is left alone; `prepare.mjs` refuses to start if the e2e ports are busy.)

## Run locally

Prerequisites: the repos checked out as siblings of this repo's parent (e.g. `C:\dev\...`), Rust, Flutter, Node 22, Google Chrome, and an empty database `m18_e2e` (created once, e.g. `CREATE DATABASE m18_e2e;`).

```sh
npm ci
npm run e2e        # prepare (reset DB schema, build server + both apps) then run the specs
npm run test:fresh # reset the DB only, then run the specs against the last builds (fast loop when editing specs)
npm test           # run the specs as-is (the data from a previous run is still in the DB)
```

The database URL is `E2E_DATABASE_URL`, or the server's `.env` `DATABASE_URL` with the database swapped to `m18_e2e`. Anything not named `m18_e2e` is refused, because every run wipes it (`migration fresh`).

## How it works

- `prepare.mjs` runs first (Playwright starts web servers before `globalSetup`): resets the schema, builds the server into `target/e2e` (so a running dev server's locked exe doesn't matter) and builds both apps with `--release --dart-define=API_URL=http://localhost:51000/api --dart-define=E2E=true`.
- `E2E=true` makes the apps enable Flutter's accessibility tree, which is what Playwright reads. Tests find widgets by role/label or by `Semantics(identifier:)` ids, exposed as the `flt-semantics-identifier` attribute (`testIdAttribute`).
- Specs run in order with one worker: `1-auth` → `2-admin-flow` (room → tenant → reading → bill) → `3-tenant-flow` (the tenant sees that bill).

## CI

`.github/workflows/m18-residences.yml` — run it from the Actions tab (choose the branch/tag of each repo) or call it from another repo's workflow with `uses: whatever413y/shared-e2e/.github/workflows/m18-residences.yml@main`.
