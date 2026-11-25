# Payroll Configuration Version Comparison

`src/policy/configurationVersions.ts` provides helpers for ordering payroll configuration versions, so an integrator can confirm that a new configuration supersedes the one in use.

## Accepted forms

| Form | Example | Notes |
|------|---------|-------|
| Positive safe integer | `3` | Treated as `3.0.0`. |
| Dotted numeric string | `"0.9"`, `"1.0.2"` | One to three segments, each at most nine digits. |

`2` and `"2.0.0"` compare equal. Anything else (zero, negative, fractional, empty, non-numeric, four or more segments) is invalid.

## API

- `compareConfigurationVersions(a, b)` returns `-1`, `0`, or `1`. It throws `ConfigurationVersionError` (`CONFIGURATION_VERSION_INVALID`) for malformed input.
- `isValidConfigurationVersion(value)` never throws.
- `isConfigurationVersionUpgrade(previous, next)` is `true` only when `next` is strictly newer.
- `assertConfigurationVersionUpgrade(previous, next)` throws `CONFIGURATION_VERSION_NOT_ADVANCING` when `next` is equal to or older than `previous`. Malformed input still raises `CONFIGURATION_VERSION_INVALID`.

```ts
import { assertConfigurationVersionUpgrade } from "@zk-payroll/core";

assertConfigurationVersionUpgrade(currentConfig.version, proposedConfig.version);
// Throws if the proposed version does not advance, so a configuration cannot
// silently replace itself or roll back.
```

## Privacy

Error messages describe the expected form and never echo the rejected value.
