import { compilePayrollPolicy, compilePayrollPolicyOrThrow } from "../src/policy/compiler";
import {
  PolicyCompileError,
  PolicyCompileErrorCode,
  type PayrollPolicyInput,
} from "../src/policy/types";
import {
  INVALID_POLICY_FIXTURE,
  MINIMAL_POLICY_FIXTURE,
  STRICT_POLICY_FIXTURE,
} from "../src/policy/fixtures";

describe("compilePayrollPolicy — minimal policy", () => {
  it("compiles successfully and matches the locked snapshot", () => {
    const result = compilePayrollPolicy(MINIMAL_POLICY_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchSnapshot();
    }
  });

  it("normalizes the asset to its canonical id", () => {
    const result = compilePayrollPolicy(MINIMAL_POLICY_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assetId).toBe("native");
    }
  });
});

describe("compilePayrollPolicy — strict policy", () => {
  it("compiles successfully and matches the locked snapshot", () => {
    const result = compilePayrollPolicy(STRICT_POLICY_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchSnapshot();
    }
  });

  it("serializes bigint capacity/reserve fields as decimal strings", () => {
    const result = compilePayrollPolicy(STRICT_POLICY_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capacity.maxTotalPayout).toBe("10000000000000");
      expect(typeof result.value.capacity.maxTotalPayout).toBe("string");
    }
  });

  it("defaults reserve.strict to true when unspecified", () => {
    const input: PayrollPolicyInput = {
      ...STRICT_POLICY_FIXTURE,
      reserveRequirements: { minReserveBalance: 1n },
    };
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reserve.strict).toBe(true);
    }
  });

  it("produces deterministic output for identical input", () => {
    const a = compilePayrollPolicy(STRICT_POLICY_FIXTURE);
    const b = compilePayrollPolicy(STRICT_POLICY_FIXTURE);
    expect(a).toEqual(b);
  });
});

describe("compilePayrollPolicy — invalid policy", () => {
  it("collects every validation failure instead of stopping at the first", () => {
    const result = compilePayrollPolicy(INVALID_POLICY_FIXTURE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain(PolicyCompileErrorCode.MISSING_FIELD); // empty policyId
      expect(codes).toContain(PolicyCompileErrorCode.INVALID_ASSET);
      expect(codes).toContain(PolicyCompileErrorCode.INVALID_SETTLEMENT_WINDOW);
      expect(codes).toContain(PolicyCompileErrorCode.INVALID_CAPACITY_LIMIT);
      expect(codes).toContain(PolicyCompileErrorCode.INVALID_RESERVE);
      expect(codes).toContain(PolicyCompileErrorCode.INVALID_AUDIT_SETTINGS);
      expect(result.errors.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("rejects an inverted settlement window (min >= max)", () => {
    const input: PayrollPolicyInput = {
      ...MINIMAL_POLICY_FIXTURE,
      settlementWindow: { minDelaySeconds: 100, maxOpenSeconds: 100 },
    };
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "settlementWindow")).toBe(true);
    }
  });

  it("rejects a per-recipient payout exceeding the total payout cap", () => {
    const input: PayrollPolicyInput = {
      ...MINIMAL_POLICY_FIXTURE,
      capacityLimits: {
        maxBatchSize: 10,
        maxTotalPayout: 100n,
        maxPerRecipientPayout: 500n,
      },
    };
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "capacityLimits.maxPerRecipientPayout")).toBe(
        true
      );
    }
  });

  it("rejects a reserve requirement exceeding max total payout", () => {
    const input: PayrollPolicyInput = {
      ...MINIMAL_POLICY_FIXTURE,
      capacityLimits: {
        maxBatchSize: 10,
        maxTotalPayout: 100n,
        maxPerRecipientPayout: 100n,
      },
      reserveRequirements: { minReserveBalance: 1000n },
    };
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "reserveRequirements.minReserveBalance")).toBe(
        true
      );
    }
  });

  it("rejects auditRequired: true with retentionDays: 0", () => {
    const input: PayrollPolicyInput = {
      ...MINIMAL_POLICY_FIXTURE,
      auditSettings: { auditRequired: true, retentionDays: 0 },
    };
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "auditSettings.retentionDays")).toBe(true);
    }
  });

  it("rejects a non-normalizable asset identifier", () => {
    const input: PayrollPolicyInput = { ...MINIMAL_POLICY_FIXTURE, asset: "USDC" }; // missing issuer
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === PolicyCompileErrorCode.INVALID_ASSET)).toBe(true);
    }
  });

  it("rejects an empty policyId", () => {
    const input: PayrollPolicyInput = { ...MINIMAL_POLICY_FIXTURE, policyId: "   " };
    const result = compilePayrollPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "policyId")).toBe(true);
    }
  });
});

describe("compilePayrollPolicyOrThrow", () => {
  it("returns the compiled policy directly on success", () => {
    const compiled = compilePayrollPolicyOrThrow(MINIMAL_POLICY_FIXTURE);
    expect(compiled.policyId).toBe("minimal");
  });

  it("throws a PolicyCompileError carrying all errors in context on failure", () => {
    try {
      compilePayrollPolicyOrThrow(INVALID_POLICY_FIXTURE);
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyCompileError);
      const allErrors = (err as PolicyCompileError).context.allErrors as unknown[];
      expect(Array.isArray(allErrors)).toBe(true);
      expect(allErrors.length).toBeGreaterThanOrEqual(6);
    }
  });
});
