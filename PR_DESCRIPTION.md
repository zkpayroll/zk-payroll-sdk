## Summary

Document the SDK’s reusable fixture-builder pattern for payroll drafts, employees, assets, and event payloads.

## Why this matters

Reusable fixtures help contributors create consistent tests without copy-pasting ad hoc sample objects. Clear fixture guidance reduces drift between test cases and protects against inconsistent or privacy-sensitive data.

## Changes

- Added a fixture-builder section to the testing guide.
- Linked the fixture workflow from the main README.
- Added a dedicated fixture README in the shared fixture directory.
- Documented privacy and redaction expectations for sensitive payroll values.

## QA

- Verified the documentation path is discoverable from the repo root.
- Reviewed the fixture examples for the key success and failure scenarios.
- Confirmed the guidance calls out privacy-sensitive redaction practices.

## Notes

This is a documentation-only change and does not alter runtime behavior.
