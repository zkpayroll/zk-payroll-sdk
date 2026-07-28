# Release & Package Publication Verification Checklist

## Overview
This checklist defines the required pre-release and post-release verification steps for publishing the `@zk-payroll/core` SDK package to npm. Following this checklist ensures release repeatability, artifact integrity, and documentation alignment.

---

## 1. Pre-Publish Package Verification

### A. Code & Version Quality
- [ ] Version bump updated in `package.json` following Semantic Versioning (`npm version patch|minor|major`).
- [ ] Working directory is clean with all changes committed (`git status`).
- [ ] All unit, browser, and integration tests pass cleanly (`npm test`).
- [ ] ESLint and Prettier checks pass without errors (`npm run lint` / `npm run format:check`).

### B. Artifact & Build Integrity
- [ ] TypeScript compilation succeeds with zero errors (`npm run build`).
- [ ] Package bundle size meets target constraints (`npm run measure-bundle`).
- [ ] Run `npm pack --dry-run` to inspect target release files and verify no sensitive test files, keys, or scratch scripts are included.

### C. Documentation Alignment
- [ ] Review `README.md` and API docs in `docs/` for accuracy against new SDK functions.
- [ ] Verify `docs/SUPPORT_MATRIX.md` matches current Stellar/Soroban SDK dependency versions.
- [ ] Ensure `CHANGELOG.md` reflects all notable features, bug fixes, and breaking changes.

---

## 2. CI/CD Workflows & Publication

- [ ] **Continuous Integration**: Verify that [.github/workflows/ci.yml](.github/workflows/ci.yml) completes with green checks on the target release commit.
- [ ] **Package Publishing**: Execute or monitor the [.github/workflows/publish.yml](.github/workflows/publish.yml) workflow for automated npm release.

---

## 3. Post-Publish Verification

- [ ] Confirm `@zk-payroll/core` package is visible on npm registry (`npm info @zk-payroll/core`).
- [ ] Verify clean installation in a fresh test project (`npm i @zk-payroll/core`).
- [ ] Verify GitHub Release tag and release notes are published.
