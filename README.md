# shared-e2e

Browser end-to-end test suites for systems that span several repos, one folder per project. Each suite starts the real services from sibling checkouts and drives them with [Playwright](https://playwright.dev).

| Suite | System under test | Workflow |
|---|---|---|
| [`m18-residences/`](m18-residences) | Rust API (`m18-residences-server`) + admin and tenant Flutter web apps | `.github/workflows/m18-residences.yml` |

Locally, clone this repo next to the repos under test (e.g. everything in `C:\dev`). In CI, each workflow checks out the repos it needs side by side and can be started manually or called from another repo (`workflow_call`).

This repo is public: suites use synthetic data and throwaway credentials only.
