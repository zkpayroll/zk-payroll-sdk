# SDK Fixture Builders

Use this directory as the canonical source for reusable SDK fixtures. The goal is to keep fixture data deterministic, readable, and easy to override in tests without copy-pasting one-off payloads across the suite.

## Principles

- Prefer hardcoded values over runtime-generated data.
- Keep fixtures grouped by concern: payroll drafts, employees, assets, and events.
- Use small builder helpers that accept overrides.
- Preserve privacy by redacting or omitting sensitive payroll values.

## Builder pattern

```typescript
export type PayrollDraftFixture = {
  id: string;
  label: string;
  employer: string;
  entries: Array<{
    recipientId: string;
    amount: string;
    asset: string;
    note?: string;
  }>;
};

export const createPayrollDraftFixture = (
  overrides: Partial<PayrollDraftFixture> = {}
): PayrollDraftFixture => ({
  id: "draft_001",
  label: "April 2025 Payroll",
  employer: "GAEMPLOYER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  entries: [
    {
      recipientId: "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      amount: "1000",
      asset: "native",
    },
  ],
  ...overrides,
});
```

This makes it easy to override a single field in a single test:

```typescript
const draft = createPayrollDraftFixture({
  label: "May 2025 Payroll",
  entries: [{ recipientId: "GAEMPLOYEE2...", amount: "2500", asset: "USDC" }],
});
```

## Employee, asset, and event fixtures

```typescript
export const createEmployeeFixture = (overrides = {}) => ({
  employeeId: "EMP-001",
  recipient: "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  department: "Engineering",
  ...overrides,
});

export const createAssetFixture = (overrides = {}) => ({
  id: "native",
  symbol: "XLM",
  decimals: 7,
  ...overrides,
});

export const createPayrollEventFixture = (overrides = {}) => ({
  type: "payroll.created",
  draftId: "draft_001",
  createdAt: "2025-04-01T00:00:00.000Z",
  ...overrides,
});
```

## QA checklist

- Valid draft fixture passes validation.
- Invalid recipient or empty draft fails as expected.
- Duplicate employee IDs or missing asset produce the expected error.
- Mixed-asset drafts emit the warning path without breaking success.
- Private values remain redacted or omitted in logs and exported fixture snapshots.

## Privacy guidance

Fixtures must never ship real payroll secrets, note data, or witness material. When an object includes a sensitive field, replace it with a placeholder such as `[REDACTED]` or omit the field entirely.
